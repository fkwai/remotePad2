import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { SshProgress } from '@remotepad2/protocol';

// A read-only view of the real OpenSSH/bootstrap processes, not another shell.
export class SshConnectionPanel {
  readonly element = document.createElement('section');
  private terminal = new Terminal({disableStdin:true,convertEol:true,fontSize:13,fontFamily:'Menlo, Consolas, monospace',scrollback:5000,theme:{background:'#151719',foreground:'#dee3e7'}});
  private fit = new FitAddon();
  private observer: ResizeObserver;
  private link = document.createElement('a');
  private phase = document.createElement('span');
  private runId = '';
  private previousPhase = '';
  private disposed = false;
  after = 0;
  constructor(private host: string) {
    this.element.className = 'connection-body'; this.element.setAttribute('aria-label','SSH connection log');
    const toolbar = document.createElement('div'); toolbar.className = 'connection-toolbar';
    this.phase.textContent = 'Connecting to ' + host;
    this.link.textContent = 'Open remote workspace ↗'; this.link.target='_blank';this.link.rel='noopener';this.link.hidden=true;
    toolbar.append(this.phase, this.link);
    const output = document.createElement('div'); output.className = 'connection-output';
    this.element.append(toolbar, output);
    this.terminal.loadAddon(this.fit); this.terminal.open(output);
    this.terminal.writeln('Connecting to ' + host + '\r\n');
    this.observer = new ResizeObserver(()=>{if(output.clientWidth&&output.clientHeight)this.fit.fit();});this.observer.observe(output);
  }
  update(data: SshProgress) {
    if (this.disposed) return;
    if (data.runId && data.runId !== this.runId) {
      this.runId=data.runId;this.after=0;this.previousPhase='';this.terminal.reset();this.terminal.writeln('SSH connection · '+this.host+'\r\n');
    }
    for (const entry of data.logs || []) if (entry.seq>this.after) {this.terminal.write(entry.text);this.after=entry.seq;}
    if (data.phase) {
      this.phase.textContent=data.phase;
      if (!data.logs?.length && !data.runId && data.phase!==this.previousPhase) this.terminal.writeln('['+data.phase+']');
      this.previousPhase=data.phase;
    }
  }
  finish(url?: string, error?: string) {
    if (this.disposed) return;
    this.phase.textContent=error?'Connection failed':'Connected to '+this.host;
    this.terminal.writeln('\r\n'+(error||'Connected. Remote workspace is ready.'));
    if(url){this.link.href=url;this.link.hidden=false;}
  }
  dispose() {this.disposed=true;this.observer.disconnect();this.terminal.dispose();}
}
