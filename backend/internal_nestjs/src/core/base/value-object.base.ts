/**
 * Base Value Object theo mẫu domain-driven-hexagon
 * Đảm bảo tính bất biến (immutability) và so sánh theo cấu trúc giá trị (structural equality)
 */
export abstract class ValueObject<T> {
  protected readonly props: T;

  constructor(props: T) {
    this.props = Object.freeze(props);
  }

  public equals(vo?: ValueObject<T>): boolean {
    if (vo === null || vo === undefined) {
      return false;
    }
    if (vo.props === undefined) {
      return false;
    }
    return JSON.stringify(this.props) === JSON.stringify(vo.props);
  }

  public getRawProps(): T {
    return this.props;
  }
}
