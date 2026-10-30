import { membershipReconciliationCsv } from "@/lib/membershipReconciliationCsv";

describe("membershipReconciliationCsv", () => {
  it("exports monthly provider reconciliation totals with payment coverage", () => {
    const csv = membershipReconciliationCsv([{
      month: "2026-10",
      coverage_from: "2026-10-24",
      coverage_to: "2026-10-30",
      successful_charges: 4,
      charges_with_amounts: 3,
      gross_collected_minor: 120050,
      refund_increases: 2,
      refunded_minor: 10050,
      net_collected_minor: 110000,
    }]);

    expect(csv).toBe([
      '"Month","Coverage from","Coverage to","Currency","Successful payments","Payments with amount","Amount coverage percent","Gross collected","Refund increases","Refunded","Net collected"',
      '"2026-10","2026-10-24","2026-10-30","INR","4","3","75.0","1200.50","2","100.50","1100.00"',
    ].join("\r\n"));
  });

  it("quotes cells and neutralizes formula-like text", () => {
    expect(membershipReconciliationCsv([{
      month: "=HYPERLINK",
      successful_charges: 0,
    }])).toContain(`"'=HYPERLINK"`);
    expect(membershipReconciliationCsv([])).toContain('"Month","Coverage from","Coverage to","Currency"');
  });
});
