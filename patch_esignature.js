const fs = require('fs');
const p = '/Users/hedilarbi/Desktop_Local/dealsautopro/server/services/esignature.service.js';
let content = fs.readFileSync(p, 'utf-8');

// Update createSignatureSession parameters
content = content.replace(
  'const createSignatureSession = async ({ saleId, seller, buyer, certificateBuffer }) => {',
  'const createSignatureSession = async ({ saleId, seller, buyer, certificateBuffer, purchaseDeclarationBuffer }) => {'
);

// Add the second document to inputDocuments
content = content.replace(
  `    inputDocuments: [
      {
        sourceType: "base64",
        payload: bufferToBase64(certificateBuffer)
      }
    ],`,
  `    inputDocuments: [
      {
        sourceType: "base64",
        payload: bufferToBase64(certificateBuffer)
      },
      {
        sourceType: "base64",
        payload: bufferToBase64(purchaseDeclarationBuffer)
      }
    ],`
);

// Add the signature for seller on page 2
content = content.replace(
  `        signatures: [
          // Certificat de cession - Vendeur
          { page: 1, x: "78", y: "300" }
        ]`,
  `        signatures: [
          // Certificat de cession - Vendeur
          { page: 1, x: "78", y: "300" },
          // Déclaration d'achat - Vendeur
          { page: 2, x: "320", y: "200" } // Ajuster si besoin pour la déclaration
        ]`
);

// Add the signature for buyer on page 2
content = content.replace(
  `        signatures: [
          // Certificat de cession - Acheteur
          { page: 1, x: "78", y: "50" }
        ]`,
  `        signatures: [
          // Certificat de cession - Acheteur
          { page: 1, x: "78", y: "50" },
          // Déclaration d'achat - Acheteur
          { page: 2, x: "78", y: "200" } // Ajuster si besoin pour la déclaration
        ]`
);

fs.writeFileSync(p, content);
console.log("Patched esignature.service.js");
