const { renderTaxDocument } = require("@devsfleet/pdf-documents");
const fs = require("node:fs");

async function main() {
  const buf = await renderTaxDocument({
    kind: "invoice",
    business: {
      legalName: "AL Lahiq Elect & Sanitary Ware TR.",
      trn: "105116613800003",
      phone: "+971557863498",
      email: null,
      addressLines: ["Rolla, Sharjah"],
    },
    branchName: "Rolla Branch",
    documentNumber: "INV-POS-TEST-1",
    issuedAt: new Date(),
    currency: "AED",
    taxLabel: "VAT",
    timezone: "Asia/Dubai",
    customer: { name: "Golden Deal Art Jewelry", company: null, phone: "+971588021440", trn: null, address: null },
    lines: [
      { productName: "13A 4G 5M extension", variantName: "Default", productSku: "SKU-1", quantity: "4", unitPrice: "55.00", beforeTax: "220.00", taxAmount: "11.00", taxPercent: "5", total: "231.00" },
    ],
    subtotal: "220.00", discountAmount: "0.00", taxAmount: "11.00", total: "231.00",
    payments: [{ method: "cash", amount: "231.00" }], dueAmount: "0.00", voided: false, notes: null,
  });
  fs.writeFileSync(process.argv[2], buf);
  console.log("bytes", buf.length);
}
main().catch((e) => { console.error("FAILED", e); process.exit(1); });
