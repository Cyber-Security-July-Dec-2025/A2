import * as openpgp from 'openpgp';

// Derive key using password for wrapping private key (AES-GCM) with WebCrypto subtle
async function deriveAesKey(password, salt){
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name:'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name:'PBKDF2', salt, iterations:150000, hash:'SHA-256' }, keyMaterial, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
}

export async function generateKeyPair(username, password){
  const { privateKey, publicKey } = await openpgp.generateKey({ type:'rsa', rsaBits:3072, userIDs:[{ name: username }], passphrase: password });
  return { privateKey, publicKey };
}

export async function exportEncryptedPrivateKey(armoredPrivateKey, password){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const key = await deriveAesKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, enc.encode(armoredPrivateKey));
  return { salt: Array.from(salt), iv: Array.from(iv), data: Array.from(new Uint8Array(cipher)) };
}

export async function importEncryptedPrivateKey(wrapped, password){
  const { salt, iv, data } = wrapped;
  const key = await deriveAesKey(password, new Uint8Array(salt));
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv: new Uint8Array(iv) }, key, new Uint8Array(data));
  return new TextDecoder().decode(plain);
}

// Encrypt chat payload: create random session key (OpenPGP handles), sign not required for each since we performed login signature
export async function encryptFor(messageObject, recipientPublicKeyArmored){
  const pub = await openpgp.readKey({ armoredKey: recipientPublicKeyArmored });
  const msg = await openpgp.createMessage({ text: JSON.stringify(messageObject) });
  return openpgp.encrypt({ message: msg, encryptionKeys: pub });
}

export async function decryptFrom(armored, privateKeyArmored, password, senderPublicKey){
  const privKey = await openpgp.decryptKey({ privateKey: await openpgp.readPrivateKey({ armoredKey: privateKeyArmored }), passphrase: password });
  const pub = await openpgp.readKey({ armoredKey: senderPublicKey });
  const message = await openpgp.readMessage({ armoredMessage: armored });
  const { data } = await openpgp.decrypt({ message, decryptionKeys: privKey, verificationKeys: pub });
  return JSON.parse(data);
}

export async function signChallenge(challenge, privateKeyArmored, password){
  const privKey = await openpgp.decryptKey({ privateKey: await openpgp.readPrivateKey({ armoredKey: privateKeyArmored }), passphrase: password });
  const clear = await openpgp.createCleartextMessage({ text: challenge });
  return openpgp.sign({ message: clear, signingKeys: privKey });
}
