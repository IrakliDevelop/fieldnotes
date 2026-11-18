const encoder = new TextEncoder();
const header = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
]);

type PdfObject = readonly Uint8Array[];

/** Escapes a value for a PDF literal string. */
export function pdfString(value: string): string {
  return `(${value.replace(/\\|\(|\)/g, '\\$&')})`;
}

/** Formats a PDF number with at most three decimal places. */
export function pdfNumber(value: number): string {
  const rounded = value.toFixed(3);
  const exponent = rounded.match(/^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i);
  if (exponent === null) return Number(rounded).toString();

  const [, sign = '', integer = '', fraction = '', power = '0'] = exponent;
  const digits = `${integer}${fraction}`;
  const decimal = integer.length + Number(power);
  if (decimal <= 0) return `${sign}0.${'0'.repeat(-decimal)}${digits}`;
  if (decimal >= digits.length) return `${sign}${digits}${'0'.repeat(decimal - digits.length)}`;
  return `${sign}${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
}

/** Deflates bytes when the host supports compression streams. */
export async function deflate(
  bytes: Uint8Array,
): Promise<{ data: Uint8Array; filter: '/FlateDecode' | null }> {
  if (globalThis.CompressionStream === undefined) {
    return { data: bytes, filter: null };
  }

  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const input = new Uint8Array(bytes.length);
  input.set(bytes);
  await writer.write(input);
  await writer.close();
  return {
    data: new Uint8Array(await new Response(stream.readable).arrayBuffer()),
    filter: '/FlateDecode',
  };
}

/** Writes a minimal PDF 1.4 file. */
export class PdfWriter {
  private readonly objects: (PdfObject | undefined)[] = [];

  /** Adds a text object and returns its object number. */
  addObject(body: string): number {
    const id = this.reserve();
    this.set(id, body);
    return id;
  }

  /** Adds a binary stream object and returns its object number. */
  addStream(dict: string, data: Uint8Array): number {
    const id = this.reserve();
    const dictionary = `${dict.slice(0, -2)} /Length ${data.length} >>`;
    this.objects[id - 1] = [
      encoder.encode(`${dictionary}\nstream\n`),
      data,
      encoder.encode('\nendstream'),
    ];
    return id;
  }

  /** Reserves an object number for a forward reference. */
  reserve(): number {
    this.objects.push(undefined);
    return this.objects.length;
  }

  /** Sets the body of a reserved object. */
  set(id: number, body: string): void {
    this.objects[id - 1] = [encoder.encode(body)];
  }

  /** Finalizes the document with its catalog and information object references. */
  finish(rootId: number, infoId: number): Uint8Array {
    const objects: PdfObject[] = [];
    for (let index = 0; index < this.objects.length; index += 1) {
      const body = this.objects[index];
      if (body === undefined) throw new Error(`PDF object ${index + 1} is unset`);
      objects.push(body);
    }

    const chunks: Uint8Array[] = [header];
    const offsets: number[] = [];
    let length = header.length;

    for (const body of objects) {
      const id = offsets.length + 1;
      const start = encoder.encode(`${id} 0 obj\n`);
      const end = encoder.encode('\nendobj\n');
      offsets.push(length);
      chunks.push(start, ...body, end);
      length += start.length + end.length;
      for (const chunk of body) length += chunk.length;
    }

    const xrefOffset = length;
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f\r\n`];
    for (const offset of offsets) xref.push(`${offset.toString().padStart(10, '0')} 00000 n\r\n`);
    xref.push(
      `trailer\n<< /Size ${objects.length + 1} /Root ${rootId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );
    chunks.push(encoder.encode(xref.join('')));

    const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  }
}
