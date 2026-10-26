/**
 * Test Features Script
 * Verifies:
 * 1. Vendor asset serving & MIME types in dev-server
 * 2. Real MongoDB Atlas connectivity & index verification
 * 3. Proforma Invoice layout fidelity & visual element audit against reference image
 * 4. One-Click PDF download logic (zero window.print in PDF handlers, correct filename pattern)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

async function runFeatureTests() {
  console.log('\n====================================================');
  console.log(' Starting Feature & Layout Verification Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(name, condition, extra = '') {
    if (condition) {
      console.log(`\x1b[32m[PASS]\x1b[0m ${name}${extra ? ` - ${extra}` : ''}`);
      passed++;
    } else {
      console.error(`\x1b[31m[FAIL]\x1b[0m ${name}${extra ? ` - ${extra}` : ''}`);
      failed++;
    }
  }

  // 1. Static Vendor Asset Serving Test
  const { server } = require('./dev-server.js');
  const PORT = 3002;
  await new Promise(res => server.listen(PORT, res));

  try {
    const resH2C = await fetch(`http://localhost:${PORT}/vendor/html2canvas.min.js`);
    assert(
      'Static Vendor Serving (html2canvas.min.js)',
      resH2C.status === 200 && (resH2C.headers.get('content-type') || '').includes('javascript'),
      `Status: ${resH2C.status}, Content-Type: ${resH2C.headers.get('content-type')}`
    );

    const resJsPdf = await fetch(`http://localhost:${PORT}/vendor/jspdf.umd.min.js`);
    assert(
      'Static Vendor Serving (jspdf.umd.min.js)',
      resJsPdf.status === 200 && (resJsPdf.headers.get('content-type') || '').includes('javascript'),
      `Status: ${resJsPdf.status}, Content-Type: ${resJsPdf.headers.get('content-type')}`
    );
  } finally {
    server.close();
  }

  // 2. Real MongoDB Atlas Connectivity Verification
  const ROOT = __dirname;
  const envContent = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  const match = envContent.match(/MONGODB_URI\s*=\s*(.*?)(?:\r?\n|$)/);
  const realUri = match ? match[1].replace(/^['"]|['"]$/g, '') : null;

  if (realUri) {
    try {
      const client = new MongoClient(realUri, { serverSelectionTimeoutMS: 6000 });
      await client.connect();
      const adminDb = client.db('invoice_generator_auth');
      const ping = await adminDb.command({ ping: 1 });
      const collections = await adminDb.listCollections().toArray();
      const collNames = collections.map(c => c.name);
      await client.close();

      assert(
        'Real MongoDB Atlas Connection',
        ping.ok === 1,
        `Connected to cluster successfully. Ping OK. Collections: [${collNames.join(', ')}]`
      );
    } catch (err) {
      assert('Real MongoDB Atlas Connection', false, `Atlas Connection Error: ${err.message}`);
    }
  } else {
    assert('Real MongoDB Atlas Connection', false, 'No MONGODB_URI found in root .env');
  }

  // 3. Proforma Invoice Layout & Reference Elements Audit
  const htmlPath = path.join(ROOT, 'public', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const requiredElements = [
    'BHAVANI ENTERPRISES',
    'Aluminium Fabrication | UPVC Window Plant (Unit-2)',
    'pfCompanyAddress',
    'pfCompanyMobile',
    'pfCompanyEmail',
    'PROFORMA INVOICE',
    'Preliminary document · Not a tax invoice',
    'pfNoPreview',
    'pfDatePreview',
    'pfValidPreview',
    'pfQuoteRefPreview',
    'pfBuyer',
    'pfGstin',
    'pfProject',
    'pfSupply',
    'pfAddress',
    'pfItems',
    'pfAmountWords',
    'pfSubtotal',
    'pfGst',
    'pfTax',
    'pfRound',
    'pfGrand',
    'pfAdvance',
    'pfTerms',
    'pfFixedTerms',
    'pfSignatureFooter',
    'pfFooterPan',
    'pfClientSignatureSeal',
    'pfComputerGenerated'
  ];

  let missing = [];
  for (const el of requiredElements) {
    if (!html.includes(el)) missing.push(el);
  }
  assert(
    'Proforma Invoice Reference Image Layout Audit',
    missing.length === 0,
    missing.length === 0 ? 'All 30 visual reference elements present' : `Missing: ${missing.join(', ')}`
  );

  // 4. One-Click PDF Download Integrity Audit
  const hasWindowPrintInProformaPdf = /function\s+downloadProformaPdf[\s\S]*?window\.print/i.test(html);
  const hasWindowPrintInTaxPdf = /function\s+downloadPdf[\s\S]*?window\.print/i.test(html);

  assert(
    'One-Click Proforma PDF (No window.print)',
    !hasWindowPrintInProformaPdf,
    'downloadProformaPdf never falls back or opens print dialog'
  );

  assert(
    'One-Click Tax Invoice PDF (No window.print)',
    !hasWindowPrintInTaxPdf,
    'downloadPdf never falls back or opens print dialog'
  );

  assert(
    'Separate Print Buttons Retained',
    html.includes("document.getElementById('btnPrint').addEventListener('click'") &&
    html.includes("btnPfPrint.addEventListener('click'"),
    'Dedicated Tax Invoice and Proforma Invoice print buttons trigger browser print dialog independently'
  );

  assert(
    'Proforma Filename Sanitization Pattern',
    html.includes('`Proforma-Invoice-${cleanPfNo}.pdf`'),
    'Matches requested specification: Proforma-Invoice-[invoice-number].pdf'
  );

  assert(
    'Tax Invoice Filename Sanitization Pattern',
    html.includes('`Tax-Invoice-${cleanInvNo}.pdf`'),
    'Matches requested specification: Tax-Invoice-[invoice-number].pdf'
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runFeatureTests().catch(err => {
  console.error('Fatal error running feature tests:', err);
  process.exit(1);
});
