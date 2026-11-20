import { randomUUID } from 'node:crypto';

export class ConnectionLog {
  readonly runId = randomUUID();
  private entries: { seq: number; text: string }[] = [];
  private bytes = 0;
  private sequence = 0;
  constructor(private limit = 128 * 1024) {}
  write(text: string) {
    // Diagnostics must not expose common credential values from package-manager errors.
    text = text.replace(/(authorization\s*[:=]\s*)(?:(?:Bearer|Basic)\s+)?[^\s]+/gi, '$1[redacted]')
      .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@');
    text = text.replace(/((?:token|password|_authToken)\s*[=:]\s*)([^\s]+)/gi, '$1[redacted]');
    const encoded = Buffer.from(text);
    if (encoded.length > this.limit) {
      let start = encoded.length - this.limit;
      while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) start++;
      text = encoded.subarray(start).toString('utf8');
    }
    this.entries.push({seq: ++this.sequence, text}); this.bytes += Buffer.byteLength(text);
    while (this.entries.length > 1 && this.bytes > this.limit) this.bytes -= Buffer.byteLength(this.entries.shift()!.text);
  }
  read(after = 0) { return {runId:this.runId, logs:this.entries.filter(entry=>entry.seq>after), nextSeq:this.sequence}; }
}
export function displayCommand(args: string[]) {
  return args.map(arg=>/^[\w./:@%+=,-]+$/.test(arg)?arg:"'"+arg.replaceAll("'", "'\"'\"'")+"'").join(' ');
}
