import { containsDiagnosticWording } from './face-safety';

describe('face safety wording', () => {
  it('rejects diagnostic disease wording', () => {
    expect(containsDiagnosticWording('This looks like eczema.')).toBe(true);
    expect(containsDiagnosticWording('Cela semble être une rosacée.')).toBe(
      true,
    );
  });

  it('allows explicit non-diagnostic disclaimers', () => {
    expect(containsDiagnosticWording('This is not a medical diagnosis.')).toBe(
      false,
    );
    expect(
      containsDiagnosticWording('Ceci ne constitue pas un diagnostic médical.'),
    ).toBe(false);
  });
});
