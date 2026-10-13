// 정산 금액을 2진 부동소수 오차 없이 계산하는 10진 소수 연산
export interface Decimal {
  // 값 = units / 10^scale
  units: bigint;
  scale: number;
}

export const ZERO: Decimal = { units: 0n, scale: 0 };
const DIVISION_SCALE = 18;

// 빈 값은 0으로, 숫자가 아니면 null로 돌려준다. Excel 천 단위 쉼표와 지수 표기도 받는다.
export function parseDecimal(text: string): Decimal | null {
  const normalized = text.trim().replace(/,/g, "");
  if (!normalized) return ZERO;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(normalized);
  if (!match || (!match[2] && !match[3])) return null;
  const [, sign, integerPart = "", fractionPart = "", exponent = "0"] = match;
  let units = BigInt(`${integerPart}${fractionPart}` || "0");
  let scale = fractionPart.length - Number(exponent);
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { units: sign === "-" ? -units : units, scale };
}

export function decimal(text: string): Decimal {
  const value = parseDecimal(text);
  if (!value) throw new Error(`Invalid decimal: ${text}`);
  return value;
}

function align(left: Decimal, right: Decimal): [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.units * 10n ** BigInt(scale - left.scale),
    right.units * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

export function add(left: Decimal, right: Decimal): Decimal {
  const [leftUnits, rightUnits, scale] = align(left, right);
  return { units: leftUnits + rightUnits, scale };
}

export function subtract(left: Decimal, right: Decimal): Decimal {
  const [leftUnits, rightUnits, scale] = align(left, right);
  return { units: leftUnits - rightUnits, scale };
}

export function multiply(left: Decimal, right: Decimal): Decimal {
  return { units: left.units * right.units, scale: left.scale + right.scale };
}

// 나누어떨어지지 않는 몫은 소수점 18자리 아래를 버린다.
export function divide(left: Decimal, right: Decimal): Decimal {
  if (right.units === 0n) throw new Error("Division by zero");
  const numerator = left.units * 10n ** BigInt(DIVISION_SCALE + right.scale);
  const denominator = right.units * 10n ** BigInt(left.scale);
  return { units: numerator / denominator, scale: DIVISION_SCALE };
}

export function isZero(value: Decimal): boolean {
  return value.units === 0n;
}

export function equals(left: Decimal, right: Decimal): boolean {
  const [leftUnits, rightUnits] = align(left, right);
  return leftUnits === rightUnits;
}

// 반올림하지 않고 끝자리 0만 지워 표시한다.
export function formatDecimal(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, "0");
  const integerPart = digits.slice(0, digits.length - value.scale);
  const fractionPart = digits.slice(digits.length - value.scale).replace(/0+$/, "");
  const text = fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
  return negative && text !== "0" ? `-${text}` : text;
}
