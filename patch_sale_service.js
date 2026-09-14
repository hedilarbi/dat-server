const fs = require('fs');
const path = require('path');
const p = '/Users/hedilarbi/Desktop_Local/dealsautopro/server/services/sale.service.js';
let content = fs.readFileSync(p, 'utf-8');

const genDeclStr = `
const generatePurchaseDeclarationDoc = async (sale, vehicle, seller, buyer) => {
  const pdf = await fillPurchaseDeclaration({
    vehicle,
    seller: { ...seller, stampUrl: null },
    buyer: { ...buyer, stampUrl: null },
    purchasedAt: sale.transferConfirmedAt || new Date(),
  });

  const filename = \`ventes/declarations/\${sale._id}_declaration-achat.pdf\`;
  const stored = await saveBuffer({ buffer: pdf, filename, contentType: 'application/pdf' });

  sale.purchaseDeclaration = {
    ...(sale.purchaseDeclaration?.toObject?.() || sale.purchaseDeclaration || {}),
    url: stored.url,
    filename: stored.filename,
    generatedAt: new Date(),
  };

  return { buffer: pdf, ...stored };
};
`;

if (!content.includes('generatePurchaseDeclarationDoc')) {
  content = content.replace('const processRegistrationCard', genDeclStr + '\nconst processRegistrationCard');
  
  content = content.replace(
    'let generatedCert = null;\n  let generatedBon = null;',
    'let generatedCert = null;\n  let generatedBon = null;\n  let generatedDecl = null;'
  );

  content = content.replace(
    'generatedBon = await generateBonEnlevement(sale, generatedCert.vehicle, generatedCert.seller, generatedCert.buyer);',
    'generatedBon = await generateBonEnlevement(sale, generatedCert.vehicle, generatedCert.seller, generatedCert.buyer);\n    generatedDecl = await generatePurchaseDeclarationDoc(sale, generatedCert.vehicle, generatedCert.seller, generatedCert.buyer);'
  );

  content = content.replace(
    'if (!generatedCert || !generatedBon)',
    'if (!generatedCert || !generatedBon || !generatedDecl)'
  );

  content = content.replace(
    'certificateBuffer: generatedCert.buffer',
    'certificateBuffer: generatedCert.buffer,\n      purchaseDeclarationBuffer: generatedDecl.buffer'
  );

  fs.writeFileSync(p, content);
  console.log("Patched sale.service.js");
} else {
  console.log("Already patched");
}
