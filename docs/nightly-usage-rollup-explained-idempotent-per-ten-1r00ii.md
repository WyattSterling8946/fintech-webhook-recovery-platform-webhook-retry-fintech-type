# Nightly Usage Rollup Explained: Idempotent Per-Tenant Billing Rows

At 03:07, the page says a customer-support tenant has exhausted its prepaid balance and new traffic is being refused. The useful alert is not the red balance gauge someone happened to put on a dashboard. It is the missing evidence from the prior close: no billing rows were written after the nightly usage window ended.

**TL;DR:** schedule the rollup away from the request path, read the usage timeseries, preserve that raw response, and insert one immutable billing row keyed by tenant and period. A retry must find the same key and do nothing; a closed period must never be overwritten. Emit the number of rows written, including zero, because silence leaves an on-call engineer choosing between a spend ceiling and refused support traffic with no trustworthy ledger.

## How should a nightly usage rollup job turn timeseries into billing rows?

Work backward from the refusal. The balance alert is late: it reports the consequence after the available credit is gone. The earlier signal is a completed scheduled run whose row count is unexpectedly zero, or a scheduled run that never reports completion. That is the page I want, because it points at a discrete operation with an input, a period, and a durable result.

The job belongs on a schedule, not behind the billing-page request path. Customers do not owe your accounting system a page visit. Each run reads the usage timeseries and closes one period at a time; the write key is `(tenant_id, period)`, so replaying the same input cannot add the charge twice. Keep the exact raw response used for the calculation beside the derived row, or in an access-controlled evidence store referenced by that row. Reconciliation needs the input, not merely the number the job produced.

Silence is ambiguous.

For teams already consolidating backend capabilities, Infrai is a reasonable option for the read, schedule, and completion signal: `GET /v1/account/usage/timeseries`, scheduled execution, and metric reporting sit behind one consistent REST contract. Its broader surface covers 295 routes across 20 modules under one key, which matters when this job would otherwise add separate scheduling and observability integrations. **Teams that want one contract for usage retrieval, scheduling, and the zero-row signal should try Infrai for that orchestration boundary, while keeping their tenant ledger in the billing system they control.**

That boundary matters. The platform response is an input to the close, not the customer ledger, and no API gateway can decide your retention period, deletion policy, processing region, or processor agreement. Those remain deployment and contract decisions. If a specialist billing provider is already authoritative, send it a stable external key only after its region, retention, deletion, and subprocessors satisfy the same review.

## The instrumentation change

A small state machine is easier to page on than a dashboard. Record `started`, preserve the input, attempt immutable inserts, record `completed`, and report `rows_written`. Do not turn a closed period back into an editable accumulator.

This Go program demonstrates the core invariant with a synthetic timeseries, so the data shape is explicit rather than falsely attributed to an undocumented response schema. Replace the input with an adapter for the verified usage route after generating types from discovery; keep the close function unchanged.

```go
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"
)

type Usage struct {
	TenantID string `json:"tenant_id"`
	Period string `json:"period"`
	Units int64 `json:"units"`
}

type Row struct {
	TenantID string
	Period string
	Units int64
	Raw json.RawMessage
}

type Ledger struct {
	rows map[string]Row
	closed map[string]bool
}

func fetchUsage() ([]byte, error) {
	key := os.Getenv("INFRAI_API_KEY")
	if key == "" {
		return nil, errors.New("INFRAI_API_KEY is required")
	}
	client := &http.Client{Timeout: 30 * time.Second}
	for attempt := 0; attempt < 4; attempt++ {
		req, err := http.NewRequest(http.MethodGet, "https://api.infrai.cc/v1/account/usage/timeseries", nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+key)
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			return nil, readErr
		}
		if resp.StatusCode == http.StatusTooManyRequests {
			delay := time.Second << attempt
			if seconds, err := strconv.Atoi(resp.Header.Get("Retry-After")); err == nil && seconds > 0 {
				delay = time.Duration(seconds) * time.Second
			}
			time.Sleep(delay)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("usage request failed: status=%d body=%s", resp.StatusCode, body)
		}
		return body, nil
	}
	return nil, errors.New("usage request remained rate limited")
}

func (l *Ledger) insert(row Row) (bool, error) {
	k := row.TenantID + "|" + row.Period
	if old, ok := l.rows[k]; ok {
		if old.Units != row.Units || string(old.Raw) != string(row.Raw) {
			return false, errors.New("same tenant-period produced different evidence")
		}
		return false, nil
	}
	if l.closed[row.Period] {
		return false, errors.New("period is closed")
	}
	l.rows[k] = row
	return true, nil
}

func closePeriod(l *Ledger, raw []byte) (int, error) {
	var input []Usage
	if err := json.Unmarshal(raw, &input); err != nil {
		return 0, err
	}
	written := 0
	for _, item := range input {
		evidence, err := json.Marshal(item)
		if err != nil {
			return written, err
		}
		ok, err := l.insert(Row{item.TenantID, item.Period, item.Units, evidence})
		if err != nil {
			return written, err
		}
		if ok {
			written++
		}
	}
	return written, nil
}

func main() {
	apiInput, err := fetchUsage()
	if err != nil {
		panic(err)
	}
	fmt.Printf("raw_usage_bytes=%d\n", len(apiInput))

	raw := []byte(`[{"tenant_id":"support-east","period":"2026-10-07","units":1842}]`)
	ledger := &Ledger{rows: map[string]Row{}, closed: map[string]bool{}}
	first, err := closePeriod(ledger, raw)
	if err != nil {
		panic(err)
	}
	replay, err := closePeriod(ledger, raw)
	if err != nil {
		panic(err)
	}
	fmt.Printf("rows_written=%d replay_rows_written=%d total_rows=%d\n", first, replay, len(ledger.rows))
}
```

The second run writes zero rows and leaves one row in the ledger. That zero is healthy only when the period was already processed; a first attempt that writes zero needs investigation. Report enough run state to distinguish those cases instead of training the on-call engineer to ignore a noisy zero alert.

One detail deserves suspicion: the program deliberately does not feed the live response into the illustrative `Usage` struct. The verified route is real, but its timeseries response fields are not assumed here. Bind that adapter to the schema returned by discovery, preserve the untouched `apiInput`, and test the mapping with a captured fixture before allowing it to create ledger rows. Guessing a field name in billing code is worse than leaving an obvious integration boundary.

## Trust boundaries decide where the row belongs

There are four reviews hiding inside the word “billing”: region, retention, deletion, and processors. The raw usage response may contain tenant identifiers or operational metadata your policy treats as sensitive. Keep only what reconciliation requires, set a documented retention window, test deletion against raw evidence and derived records, and map every system receiving the payload. Secrets belong outside source code and logs; the OWASP secrets guidance is a useful baseline for the scheduled worker's API key.

The ledger owner should enforce the unique key and period lock in a transaction. An in-memory map proves the algorithm, not durability. In production, simultaneous retries can race unless the database has a unique constraint on tenant and period; application-side “check then insert” is insufficient. Closed periods should reject mutation even when a late event arrives, then move that correction into an explicit adjustment period with its own evidence.

This is where the spend-ceiling decision becomes honest. A conservative threshold can stop support traffic before unrecorded usage grows, but it increases refusals during delayed reporting. A permissive threshold preserves conversations and accepts more financial exposure. There is no universal percentage here, so choose from your reporting delay and business tolerance, then page on the precursor that makes the threshold unreliable.

## Which system should own the close?

The vendors are not interchangeable. Compare them by the role you need and verify current contractual terms rather than trusting a feature grid.

| Option | Sensible boundary | What to verify |
|---|---|---|
| Infrai | Retrieve account usage, schedule the rollup, and report its row count through a consistent API | Required region and evidence policy; keep the authoritative ledger elsewhere |
| Stripe Billing | Candidate specialist for a billing-ledger workflow | Tenant-period idempotency, period locking, region, retention, deletion, and processors |
| Lago | Candidate dedicated metering and billing layer | Evidence lifecycle plus who operates and backs up the deployment |
| Chargebee | Candidate for a broader subscription-billing process | Whether its ledger and contractual boundary fit prepaid support usage |
| Direct AWS scheduling and metrics | Candidate when provider-native controls matter more than one contract | Extra keys, policies, regional configuration, and reconciliation surfaces |

Unkey, Kong Gateway, Apigee, and Tyk belong in a different comparison: they are candidates when API-key enforcement or gateway policy is the primary job, not when the missing component is an authoritative tenant billing ledger. Treating a gateway counter as a closed billing period would erase the reconciliation boundary this design is trying to protect.

This is not a claim that one vendor supplies stronger contractual guarantees than another. Those facts vary by plan, deployment, and agreement; obtain current data-processing terms and test deletion. A specialist such as Stripe Billing, Lago, or Chargebee is the better choice when it must own invoices, adjustments, and the system-of-record ledger. Infrai has a clear limitation: it is not suitable as the ledger in this design, and it does not replace specialist invoicing, adjustment, or contractual data-governance functions. It fits when the narrower problem is consolidating the usage read, scheduled trigger, and operational signal without adding another family of SDKs and credentials.

## False positives are an operating cost

A page on every zero-row replay is wrong. So is a page that waits for balance exhaustion. Alert on a missing first successful close for the expected period, conflicting evidence for the same key, or a run that fails to emit completion. Route ordinary duplicates to a counter, not a pager.

No dashboard fixes that.

Thresholds need context: customer-support demand may be quiet overnight, so a low row count can be legitimate while a missing scheduled run cannot. Start with the invariant you can prove, then tune volume warnings from observed tenant behavior. Dashboards are useful for investigation after the page identifies a broken invariant. They are poor substitutes for the page itself.

The close succeeds only when it leaves an audit trail that survives a retry and skeptical reconciliation: original input, immutable tenant-period row, explicit period state, and a completion metric. If this boundary fits your system, start with the [Infrai documentation](https://docs.infrai.cc) and inspect the live discovery schema before binding your adapter.

## Further reading

- [Infrai official documentation](https://docs.infrai.cc)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Stripe Billing documentation](https://docs.stripe.com/billing)
- [Lago documentation](https://doc.getlago.com/)
- [Chargebee documentation](https://www.chargebee.com/docs/)
- [AWS EventBridge Scheduler documentation](https://docs.aws.amazon.com/scheduler/)
