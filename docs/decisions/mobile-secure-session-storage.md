# Mobile Secure Session Storage

Reference: `FP-MOBILE-SECURE-SESSION-IMPLEMENT-08`

## Current risk

Supabase Auth previously received AsyncStorage directly. Access tokens, refresh tokens and session metadata could therefore remain in plaintext local storage.

## Options examined

- One SecureStore value was rejected because installed `expo-secure-store` 15.0.8 documents a 2,048-byte value limit and realistic Supabase sessions can exceed it.
- Encrypted AsyncStorage was rejected because it would introduce encryption coordination, key handling and a custom cryptographic dependency outside this phase.
- Versioned SecureStore chunking with generation swapping was selected.

## Selected design

The shared mobile-core adapter uses SecureStore for every session chunk, manifest and active pointer. It uses 1,500-byte UTF-8 chunks with a 64 KiB session safety ceiling. Two fixed generations, `a` and `b`, make all keys enumerable for logout and corruption cleanup.

A replacement is written to the inactive generation. Chunks are written first, then the manifest. The full value is read back, byte lengths and session structure are checked, and only then is the active pointer changed. The prior generation remains available during activation. The pointer is finalised before the prior generation is deleted. An in-process namespace queue serialises refresh writes.

SecureStore supplies platform protection. The adapter does not implement encryption, key derivation, ciphertext formats or authentication hashes. Coordination integrity uses total UTF-8 byte length, per-chunk byte lengths, deterministic chunk count, JSON structure and approved test-project session validation. SecureStore supplies authenticated platform storage beneath that protocol.

## Namespace and migration

The namespace format is:

`fp.mobile.auth.v1.<coach|parent>.<environment>.<logical-supabase-key>`

Runtime creation currently accepts only the verified `test` environment and approved test Supabase project. Unknown app, unknown environment, live, production, retired and unknown project identities fail closed.

The exact legacy key is `sb-ndohkecigwlwayghsopw-auth-token`. A valid current secure session wins. Otherwise, an approved legacy test session is written securely, read back and compared before plaintext deletion. Migration is idempotent. Its marker is non-sensitive and never overrides actual secure-session validity. Interrupted migration retains either the active secure generation or the legacy value.

Corrupt secure storage cannot authenticate a user. A still-valid approved legacy value can repair it; otherwise all known invalid local session generations are cleared and sign-in is required. Production, retired and unknown legacy sessions are rejected and are not migrated.

## Logout and biometrics

The shared logout path clears both generations, manifests, the active pointer, migration state, Supabase auxiliary Auth keys and legacy plaintext. The fixed generation inventory makes repeated cleanup deterministic.

The existing product policy disables the biometric preference at sign-out, and this behaviour is preserved. Session chunks use `requireAuthentication: false`, so background token refresh does not prompt for biometrics. Biometric preference keys and session namespaces remain separate. Biometrics are only a local UI lock and do not replace Supabase Auth or RLS.

## Validation boundary

This decision proves shared implementation and automated behaviour only. It does not prove Android Keystore, iOS Keychain, backup, reinstall, biometric-enrolment, terminated-app refresh or physical-device behaviour. No build, EAS change, deployment, Supabase change, Netlify change or production access is part of this phase.
