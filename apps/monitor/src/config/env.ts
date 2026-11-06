type Environment = Record<string, string | undefined>;

type NumberRules = { min?: number; max?: number; whole?: boolean };

const describeNumber = ({ min = 0, max, whole = false }: NumberRules) => {
  const kind = whole ? 'a whole number' : 'a number';
  return max === undefined ? `${kind} of ${min} or more` : `${kind} from ${min} to ${max}`;
};

/**
 * Reads settings. A wrong value is recorded as a problem and its fallback used, so reading goes on and every problem
 * can be reported at once.
 */
const createEnvReader = (env: Environment) => {
  const problems: string[] = [];

  /** An unset or empty variable is not set. */
  const text = (name: string) => {
    const value = env[name];
    return value === undefined || value === '' ? undefined : value;
  };

  return {
    text,
    oneOf: <Value extends string>(name: string, values: readonly Value[], fallback: Value): Value => {
      const value = text(name);
      const known = values.find((each) => each === value);
      if (value !== undefined && known === undefined) {
        problems.push(`${name} must be one of ${values.join(', ')}, not "${value}"`);
      }
      return known ?? fallback;
    },
    number: (name: string, fallback: number, rules: NumberRules = {}) => {
      const value = text(name);
      if (value === undefined) {
        return fallback;
      }

      const { min = 0, max = Infinity, whole = false } = rules;
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max || (whole && !Number.isInteger(parsed))) {
        problems.push(`${name} must be ${describeNumber(rules)}, not "${value}"`);
        return fallback;
      }
      return parsed;
    },
    problems: () => [...problems],
  };
};

export { createEnvReader };
export type { Environment };
