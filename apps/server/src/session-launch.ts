import os from 'node:os';
import path from 'node:path';
import {statSync} from 'node:fs';
import {agentKinds,type SessionCreate,type AgentKind} from '@remotepad2/protocol';

// Parse argv, never evaluate a shell program. A shell can be requested explicitly.
export function commandArguments(command:string):string[] {
  if(typeof command!=='string'||command.length>4096||/[\0\r\n]/.test(command))throw new Error('Enter one CLI command with optional quoted arguments.');
  const args:string[]=[];let token='',quote='',escape=false,started=false;
  const characters=[...command];
  for(let index=0;index<characters.length;index++){
    const char=characters[index];
    if(escape){token+=char;escape=false;continue;}
    if(char==='\\'&&quote!=="'"){
      if(quote==='\"'&&!['\"','\\','$','`'].includes(characters[index+1]||'')){token+='\\';started=true;continue;}
      escape=true;started=true;continue;
    }
    if(quote){if(char===quote)quote='';else token+=char;continue;}
    if(char==='"'||char==="'"){quote=char;started=true;continue;}
    if(/\s/.test(char)){if(started){args.push(token);token='';started=false;}}else{token+=char;started=true;}
  }
  if(quote||escape)throw new Error('Close the quote or escaped argument in the CLI command.');
  if(started)args.push(token);
  if(!args[0]||args.length>64)throw new Error('Choose an executable and at most 63 arguments.');
  return args;
}

export function sessionLaunch(input:SessionCreate={}) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Invalid session options.');
  const agent=input.agent??(input.codexId?'codex':'shell');
  if(!agentKinds.some(row=>row.id===agent))throw new Error('Unknown agent type.');
  for(const [key,limit] of [['name',160],['project',100],['cwd',4096]] as const){
    const value=input[key];if(value!==undefined&&(typeof value!=='string'||value.length>limit||/[\0\r\n]/.test(value)))throw new Error('Invalid session '+key+'.');
  }
  if(input.codexId!==undefined&&(typeof input.codexId!=='string'||!input.codexId||input.codexId.length>200))throw new Error('Invalid Codex session.');
  if(input.codexId&&agent!=='codex')throw new Error('Codex history must use the Codex agent.');
  if(input.command!==undefined&&agent!=='custom')throw new Error('A CLI command is only used for Custom CLI.');
  const cwd=path.resolve(input.cwd?.trim()||os.homedir());
  if(!statSync(cwd).isDirectory())throw new Error('Choose a working directory.');
  const command=agent==='custom'?commandArguments(input.command!):agent==='codex'?['codex',...(input.codexId?['resume',input.codexId]:[]),'--no-alt-screen']:agent==='claude'?['claude']:[os.userInfo().shell||'/bin/bash','-l'];
  const label=agentKinds.find(row=>row.id===agent)!.label;
  return {agent:agent as AgentKind,cwd,project:input.project?.trim()||path.basename(cwd)||cwd,name:input.name?.trim()||(agent==='custom'?path.basename(command[0]):label),renamed:Boolean(input.name?.trim()),executable:command[0],args:command.slice(1)};
}
