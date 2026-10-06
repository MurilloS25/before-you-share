# Claims and wording

The tool may say:

- "Experimental copy", "These selected fields were no longer detected", "Other hidden information may
  remain", "Open and check this copy before sharing it", "Keep your original".
- "Verified" only for values read directly from the file; "Inferred" for indicators from names or
  patterns; "Suspicious" for unusual or inconsistent structure (never "malicious"); "Not supported" and
  "Unavailable" where the tool cannot read something.
- "Local": the file is read and processed in this browser tab; the page cannot make network requests
  (enforced by CSP and tested). Not "private" or "secure" without that context.

The tool must not say:

- "safe file", "fully clean", "all metadata removed", "sanitized" (as a guarantee), "anonymous" (as a
  promise), "secure", "protected", "malware-free", "certified", "guaranteed".
- A privacy score, a risk level, or alarm language ("leak", "exposed", "danger").
- That a hash proves safety. SHA-256 only identifies bytes.

`tests/claims.test.ts` scans user-visible strings in `src/` for the forbidden phrases, allowing them only
inside explicit disclaimers ("cannot guarantee ...", "not antivirus ...", "never says ...").
