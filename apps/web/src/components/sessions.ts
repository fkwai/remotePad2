import {agentKinds,type AgentKind,type CodexSession,type SessionCreate,type SessionInfo} from '@remotepad2/protocol';
import {api,button} from '../api';
import {sshTarget} from '../connection';
import {iconControl} from './icons';
import {menu} from './menu';

interface SessionActions {
 open:(session:SessionInfo)=>void;
 createShell:()=>void;
 launch:(options:SessionCreate)=>Promise<void>;
 rename:(session:SessionInfo)=>Promise<void>;
 close:(session:SessionInfo)=>Promise<void>;
 resume:(id:string)=>Promise<void>;
 directory:()=>string;
 metadata?:(sessions:CodexSession[])=>void;
}
export class SessionsIndex {
 readonly element=document.createElement('section');
 private running=document.createElement('div');
 private codex=document.createElement('div');
 private error=document.createElement('div');
 private search=document.createElement('input');
 private provider=document.createElement('select');
 private state=document.createElement('select');
 private items:SessionInfo[]=[];
 private history:CodexSession[]=[];
 private active='';
 private signature='';
 private resuming=new Set<string>();
 constructor(private actions:SessionActions){
  this.element.className='index sessions-index';this.element.setAttribute('aria-label','Sessions Index');
  const heading=document.createElement('div');heading.className='session-heading';
  const title=document.createElement('h2');title.textContent='Sessions';
  const create=iconControl(button('',()=>{form.hidden=!form.hidden;create.setAttribute('aria-expanded',String(!form.hidden));if(!form.hidden){cwd.value=actions.directory();name.focus();}}),'New session','plus');create.setAttribute('aria-expanded','false');
  heading.append(title,iconControl(button('',actions.createShell),'New shell','terminal'),create);
  const form=document.createElement('form');form.className='session-create';form.hidden=true;form.setAttribute('aria-label','Create session');
  const agent=document.createElement('select');agent.setAttribute('aria-label','Agent type');
  for(const kind of agentKinds)agent.add(new Option(kind.label,kind.id));agent.value='codex';
  const name=document.createElement('input');name.setAttribute('aria-label','Session name');name.placeholder='e.g. API refactor';name.maxLength=160;
  const cwd=document.createElement('input');cwd.setAttribute('aria-label','Working directory');cwd.placeholder='Default working directory';
  const project=document.createElement('input');project.setAttribute('aria-label','Project label');project.placeholder='Directory name by default';project.maxLength=100;
  const command=document.createElement('input');command.setAttribute('aria-label','CLI command');command.placeholder='my-agent --option "some value"';command.maxLength=4096;
  const field=(text:string,control:HTMLElement)=>{const label=document.createElement('label');label.append(text,control);return label;};
  const custom=field('CLI command',command);custom.hidden=true;
  const help=document.createElement('small');help.textContent='Runs on this machine. Install and sign in to the agent CLI first.';
  agent.onchange=()=>{custom.hidden=agent.value!=='custom';command.required=!custom.hidden;};
  const submit=iconControl(button('',()=>{}),'Start session','connect');submit.type='submit';
  const cancel=button('×',()=>{form.hidden=true;create.setAttribute('aria-expanded','false');},'Cancel session creation');cancel.type='button';cancel.setAttribute('aria-label','Cancel session creation');
  const controls=document.createElement('div');controls.className='session-create-actions';controls.append(submit,cancel);
  form.append(field('Agent',agent),field('Name (optional)',name),field('Working directory',cwd),field('Project (optional)',project),custom,help,controls);
  form.onsubmit=event=>{
   event.preventDefault();this.error.textContent='';submit.disabled=true;
   const options:SessionCreate={agent:agent.value as AgentKind,...(name.value.trim()?{name:name.value.trim()}:{}),...(cwd.value.trim()?{cwd:cwd.value.trim()}:{}),...(project.value.trim()?{project:project.value.trim()}:{}),...(agent.value==='custom'?{command:command.value}:{})};
   void actions.launch(options).then(()=>{form.hidden=true;create.setAttribute('aria-expanded','false');name.value='';}).catch(reason=>{this.error.textContent=reason.message;}).finally(()=>{submit.disabled=false;});
  };
  this.search.type='search';this.search.placeholder='Search sessions…';this.search.setAttribute('aria-label','Search sessions');
  this.provider.setAttribute('aria-label','Filter agent');this.provider.add(new Option('All agents',''));for(const kind of agentKinds)this.provider.add(new Option(kind.label,kind.id));
  this.state.setAttribute('aria-label','Filter session status');for(const [value,label]of [['','All states'],['running','Running'],['exited','Exited']])this.state.add(new Option(label,value));
  this.search.oninput=()=>this.draw();this.provider.onchange=()=>this.draw();this.state.onchange=()=>this.draw();
  const filters=document.createElement('div');filters.className='session-filters';filters.append(this.provider,this.state);
  const codexHeading=document.createElement('div');codexHeading.className='index-modes';codexHeading.append('Codex history',iconControl(button('',()=>void this.loadHistory()),'Refresh Codex sessions','refresh'));
  this.error.className='error';this.error.setAttribute('role','alert');
  this.element.append(heading,form,this.search,filters,this.error,this.running,codexHeading,this.codex);
  void this.loadHistory();window.setInterval(()=>{if(!this.resuming.size)void this.loadHistory();},10000);
 }
 private async loadHistory(){
  try{const {sessions}=await api<{sessions:CodexSession[]}>('/api/codex/sessions');this.history=sessions;this.actions.metadata?.(sessions);this.draw();}
  catch(reason){this.error.textContent=(reason as Error).message;}
 }
 private draw(){
  const query=this.search.value.trim().toLowerCase(),provider=this.provider.value,state=this.state.value;
  const match=(...values:(string|undefined)[])=>values.join(' ').toLowerCase().includes(query);
  const label=(info:SessionInfo)=>agentKinds.find(kind=>kind.id===(info.agent||(info.codexId?'codex':'shell')))?.label||'Shell';
  const visible=this.items.filter(info=>(!provider||(info.agent||(info.codexId?'codex':'shell'))===provider)&&(!state||info.alive===(state==='running'))&&match(info.name,label(info),info.project,info.cwd,info.machine,sshTarget));
  this.running.replaceChildren();
  for(const info of visible){
   const row=button('',()=>this.actions.open(info),info.cwd+'\n'+info.id);row.className='session-row'+(info.id===this.active?' active':'');
   const title=document.createElement('span');title.className='session-title';title.textContent=info.name;
   const agent=document.createElement('span');agent.className='agent-tag';agent.textContent=info.kind==='ssh-connect'?'SSH':label(info)+(info.kind==='codex-app'?' · App':'');
   const detail=document.createElement('small');detail.className='session-details';
   const project=document.createElement('span');project.className='project-tag';project.textContent=info.project||info.cwd.split('/').filter(Boolean).pop()||'/';
   const machine=document.createElement('span');machine.className='machine-tag';machine.textContent=info.kind==='ssh-connect'?'Local':sshTarget||info.machine||'Local';
   detail.append(project,machine);
   const status=document.createElement('span');status.className='session-state'+(info.alive?' live':'');status.textContent=info.kind==='codex-app'?'App linked':info.alive?'Running':'Exited'+(info.exitCode!==undefined?' · '+info.exitCode:'');
   status.title=info.kind==='codex-app'?'Codex App follower':'Process state; agent activity is not inferred from terminal output';
   row.append(title,agent,detail,status);
   row.oncontextmenu=event=>menu(event,[{label:'Open',action:()=>this.actions.open(info)},...(info.kind!=='codex-app'?[{label:'Rename',action:()=>{void this.actions.rename(info).catch(reason=>{this.error.textContent=reason.message;});}}]:[]),{label:info.kind==='codex-app'?'Detach':'Close session',action:()=>{void this.actions.close(info).catch(reason=>{this.error.textContent=reason.message;});}}]);
   this.running.append(row);
  }
  if(!visible.length){const empty=document.createElement('p');empty.className='session-empty';empty.textContent=this.items.length?'No matching sessions':'No managed sessions yet';this.running.append(empty);}
  this.codex.replaceChildren();
  const histories=(!provider||provider==='codex')&&!state?this.history.filter(info=>match(info.title,'Codex',info.project,info.cwd,sshTarget)):[];
  for(const info of histories){
   const row=button('',()=>{if(this.resuming.has(info.id))return;this.resuming.add(info.id);row.disabled=true;void this.actions.resume(info.id).catch(reason=>{this.error.textContent=reason.message;}).finally(()=>{this.resuming.delete(info.id);this.draw();});},info.cwd+'\nResume in a terminal');row.className='codex-row';row.disabled=this.resuming.has(info.id);
   const title=document.createElement('span');title.textContent=info.title;
   const detail=document.createElement('small');const project=document.createElement('span');project.className='project-tag';project.textContent=info.project||info.cwd.split('/').pop()||'/';detail.append(project,document.createTextNode(' · '+new Date(info.updatedAt).toLocaleDateString()));row.append(title,detail);this.codex.append(row);
  }
  if(!histories.length)this.codex.textContent='No matching Codex history';
 }
 render(sessions:SessionInfo[],active:string){
  const sorted=[...sessions].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)||a.id.localeCompare(b.id));
  const signature=JSON.stringify([sorted,active]);if(signature===this.signature)return;this.signature=signature;
  this.items=sorted;this.active=active;this.draw();
 }
}
