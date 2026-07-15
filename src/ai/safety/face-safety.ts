const ALLOWED_NON_DIAGNOSTIC_PHRASES = [
  /\b(?:this|it|the result)\s+(?:is|does)\s+not\s+(?:constitute\s+)?(?:a\s+)?(?:medical\s+)?diagnosis\b/gi,
  /\bnot\s+(?:a\s+)?(?:medical\s+)?diagnosis\b/gi,
  /\bne\s+(?:constitue|remplace)\s+pas\s+un\s+diagnostic(?:\s+m[eé]dical)?\b/gi,
  /\bn['’]est\s+pas\s+un\s+diagnostic(?:\s+m[eé]dical)?\b/gi,
];

const DIAGNOSTIC_WORDING =
  /\b(ecz[eé]ma|rosac[eé]e?|psoriasis|dermatitis|dermatite|infection|infected|fungal|fongique|allerg(?:y|ic|ie|ique)|hormonal|cancer|melanoma|m[eé]lanome|malignant|maligne?|benign|b[eé]nin|diagnos(?:e|ed|ing|is|tic)|diagnostiqu(?:e|er|é|ée|és|ées))\b/i;

export function containsDiagnosticWording(value: string): boolean {
  const sanitized = ALLOWED_NON_DIAGNOSTIC_PHRASES.reduce(
    (text, pattern) => text.replace(pattern, ''),
    value,
  );
  return DIAGNOSTIC_WORDING.test(sanitized);
}
