import type { SshProgress } from '@remotepad2/protocol';
import type { SshConnectionPanel } from './ssh-connection';
import { localFetch } from '../base';
import { profile, sshTarget } from '../connection';
import { button } from '../api';
import { iconControl } from './icons';
import { popover } from './popover';

type Machine = {id:string;name:string;command:string};
type Hosts = {local:{hostname:string;user:string;platform:string;arch:string;homedir:string};hosts:string[];connected:string[];saved?:Machine[]};
export function connectionsButton(host: HTMLElement, status: (message: string) => void, showConnection: (command: string) => SshConnectionPanel) {
  const toggle = popover(host, 'Computers', (current, close) => {
    current.classList.add('ssh-manager');
    let data:Hosts|undefined, busy='', signature='';
    const info=document.createElement('div');info.className='ssh-local';info.textContent='Loading local machine…';
    const head=document.createElement('div');head.className='ssh-heading';
    head.append('SSH connections',iconControl(button('',()=>void reload()),'Refresh SSH connections','refresh'));
    const active=document.createElement('div');active.className='ssh-machines';
    const progress=document.createElement('div');progress.setAttribute('role','status');progress.className='connection-progress';
    const error=document.createElement('div');error.className='error';error.setAttribute('role','alert');
    const add=document.createElement('details');
    const summary=document.createElement('summary');summary.textContent='Add SSH connection';add.append(summary);
    const aliases=document.createElement('div');aliases.className='ssh-aliases';
    const configHeading=document.createElement('h3');configHeading.textContent='From SSH config';add.append(configHeading,aliases);
    const form=document.createElement('form');
    const input=document.createElement('input');input.setAttribute('aria-label','SSH command');input.placeholder='Alias, user@host, or ssh -J jump user@host';
    const name=document.createElement('input');name.setAttribute('aria-label','Machine name');name.placeholder='Display name (optional)';name.maxLength=100;
    const actions=document.createElement('div');actions.className='ssh-form-actions';
    const saveButton=button('Save machine',()=>{});saveButton.type='submit';
    const connectButton=button('Connect',()=>{if(input.value.trim())void connect(input.value.trim());});connectButton.type='button';connectButton.dataset.connect='';
    actions.append(saveButton,connectButton);form.append(input,name,actions);add.append(form);
    current.append(info,head,active,progress,error,add);
    const fail=(reason:unknown)=>{error.textContent=(reason as Error).message;};
    const save=async(command:string,label?:string)=>{
      const response=await localFetch('/api/ssh/machines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,name:label})});
      const result=await response.json();if(!response.ok)throw new Error(result.error || 'Could not save machine.');
      await reload();status('Saved '+(label||command));
    };
    form.onsubmit=event=>{event.preventDefault();error.textContent='';saveButton.disabled=true;
      void save(input.value.trim(),name.value.trim()).then(()=>{input.value='';name.value='';add.open=false;}).catch(fail).finally(()=>{saveButton.disabled=false;});
    };
    const open=(command:string)=>{
      const url=new URL(location.href);url.searchParams.set('ssh',command);if(profile!=='default')url.searchParams.set('w',profile);
      const remote=window.open(url.href,'_blank');if(remote){remote.opener=null;close();}
    };
    const row=(command:string,label:string,id?:string)=>{
      const line=document.createElement('div');line.className='ssh-machine';line.dataset.command=command;
      const connected=data!.connected.includes(command), connecting=busy===command;
      const details=document.createElement('div');details.className='ssh-machine-info';
      const title=document.createElement('strong');title.textContent=label;
      const destination=document.createElement('small');destination.textContent=command;destination.hidden=label===command;
      const state=document.createElement('span');state.className='ssh-state'+(connecting?' pending':connected?' connected':'');state.textContent=connecting?'Connecting…':connected?'Connected':'Not connected';
      details.append(title,destination,state);
      const action=button(connected?'Open':'Connect',()=>connected?open(command):void connect(command));action.dataset.connect='';action.disabled=Boolean(busy);
      line.append(details,action);
      if(id){const remove=iconControl(button('',()=>{
        error.textContent='';void localFetch('/api/ssh/machines/'+encodeURIComponent(id),{method:'DELETE'}).then(async response=>{if(!response.ok)throw new Error('Could not remove machine.');await reload();}).catch(fail);
      }),'Remove saved machine '+label,'trash');remove.title='Remove from saved machines (keep connection)';line.append(remove);}
      else {const pin=iconControl(button('',()=>{error.textContent='';void save(command,label).catch(fail);}), 'Save '+label, 'favorite');line.append(pin);}
      return line;
    };
    const render=()=>{
      if(!data)return;
      const next=JSON.stringify([data.saved,data.connected,data.hosts,busy]);if(next===signature)return;signature=next;
      active.replaceChildren();
      const saved=data.saved||[];
      if(!saved.length){const empty=document.createElement('p');empty.className='ssh-empty';empty.textContent='No saved machines. Add one below.';active.append(empty);}
      for(const machine of saved)active.append(row(machine.command,machine.name,machine.id));
      const others=[...new Set([...(sshTarget?[sshTarget]:[]),...data.connected])].filter(command=>!saved.some(machine=>machine.command===command));
      if(others.length){const title=document.createElement('h3');title.textContent='Other connections';active.append(title);for(const command of others)active.append(row(command,command));}
      aliases.replaceChildren();
      for(const command of data.hosts){
        const line=document.createElement('div');line.className='ssh-config-row';
        const choose=button(command,()=>void connect(command));choose.dataset.connect='';choose.disabled=Boolean(busy);
        const savedAlready=saved.some(machine=>machine.command===command);
        const pin=iconControl(button('',()=>{error.textContent='';void save(command).catch(fail);}),savedAlready?'Saved '+command:'Save '+command,'favorite');pin.disabled=savedAlready;pin.classList.toggle('pinned',savedAlready);
        line.append(choose,pin);aliases.append(line);
      }
      if(!data.hosts.length)aliases.textContent='No SSH config hosts found.';
      connectButton.disabled=Boolean(busy);
    };
    async function reload(){
      const response=await localFetch('/api/ssh/hosts');const result=await response.json();if(!response.ok)throw new Error(result.error);
      if(!current.isConnected)return;data=result;
      const heading=document.createElement('h3');heading.textContent=data!.local.hostname;
      const description=document.createElement('p');description.textContent=`${data!.local.user} · ${data!.local.platform} ${data!.local.arch}`;
      const home=document.createElement('small');home.textContent=data!.local.homedir;
      const local=button(sshTarget?'Switch to local':'● Local machine',()=>{const url=new URL(location.href);url.searchParams.delete('ssh');location.assign(url.href);});
      info.replaceChildren(heading,description,home,local);render();
    }
    const connect=async(command:string)=>{
      if(busy)return;busy=command;error.textContent='';render();
      progress.textContent='Connecting to '+command+' · preparing remote backend…';status(progress.textContent);
      const view = showConnection(command);
      let finished = false;
      const readProgress = async (final = false) => {
        const response = await localFetch('/api/ssh/' + encodeURIComponent(command) + '/status?after=' + view.after);
        const data = await response.json() as SshProgress; if (response.ok && (!finished || final)) view.update(data); return data;
      };
      const started = Date.now();
      let checking = false;
      const poll = window.setInterval(() => {
        if (checking) return; checking = true;
        void readProgress().then((data) => {
          if (finished) return;
          const elapsed = Math.floor((Date.now() - (data.startedAt || started)) / 1000);
          const message = 'Connecting to ' + command + ' · ' + (data.phase || 'Preparing remote backend') + ' · ' + elapsed + 's';
          progress.textContent = message; status(message);
        }).catch(() => {}).finally(() => { checking = false; });
      }, 750);
      progress.scrollIntoView({ block: 'nearest' });
      try {
        const response = await localFetch('/api/ssh/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: command }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        const url = new URL(location.href); url.searchParams.set('ssh', command); if (profile !== 'default') url.searchParams.set('w', profile);
        finished = true; window.clearInterval(poll);
        await readProgress(true).catch(() => {});
        if(data && !data.connected.includes(command))data.connected.push(command);
        view.finish(url.href);
        const remote = window.open(url.href, '_blank');
        if (remote) { remote.opener = null; close(); status('Connected to ' + command + ' · opened in a new tab'); }
        else {
          progress.textContent = 'Connected · open remote workspace ↗';
          const open = document.createElement('a'); open.href = url.href; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Open remote workspace'; progress.append(document.createElement('br'), open);
          status('Connected to ' + command + ' · use Open remote workspace in the connection terminal');
        }
      } catch (error) {
        finished = true; window.clearInterval(poll);
        await readProgress(true).catch(() => {}); view.finish(undefined, (error as Error).message);
        progress.textContent = (error as Error).message; status('SSH ' + command + ': ' + progress.textContent);

      } finally { finished = true; window.clearInterval(poll); busy=''; render(); }
    };
    void reload().catch(reason=>{info.textContent='Machine information unavailable';fail(reason);});
    const poll=()=>{if(!current.isConnected)return;void reload().catch(fail).finally(()=>{if(current.isConnected)window.setTimeout(poll,3000);});};
    window.setTimeout(poll,3000);
  });
  toggle.textContent=sshTarget || 'Local machine';toggle.title=sshTarget?'SSH: '+sshTarget:'Local machine';
  toggle.classList.toggle('remote-target',Boolean(sshTarget));
  void localFetch('/api/ssh/hosts').then(r=>r.json()).then(data=>{if(!sshTarget){toggle.textContent=data.local.hostname;toggle.title='Local machine';}}).catch(()=>{});
  return (remoteHostname:string)=>{if(sshTarget)toggle.title='SSH: '+sshTarget+' · '+remoteHostname;};
}
