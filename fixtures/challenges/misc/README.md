# Benign encoding puzzle

`input.txt` is ordinary UTF-8 text containing padded base64 of hexadecimal bytes. Decode base64, then hex, retaining original identity and each saved/consumed transformation's provenance. Candidate framing is `puzzle{...}`.

Only `input.txt` is method input. The equality oracle lives in the separate test-controller module `oracle.ts`; no model is involved.
