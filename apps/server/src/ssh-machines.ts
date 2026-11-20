import {randomUUID} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, renameSync} from 'node:fs';
import path from 'node:path';
import {parseSsh} from './ssh.ts';

export interface SavedMachine {id:string; name:string; command:string}

// Saved destinations are shared by local lanes; never edit the user's SSH config.
export function savedMachines(home: string) {
  const file=path.join(home,'.remotepad2/ssh-machines.json');
  const read=():SavedMachine[]=>{
    try { return JSON.parse(readFileSync(file,'utf8')); }
    catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return []; throw error; }
  };
  const write=(rows:SavedMachine[])=>{
    mkdirSync(path.dirname(file),{recursive:true});
    const temp=file+'.'+process.pid+'.tmp';
    writeFileSync(temp,JSON.stringify(rows,null,2),{mode:0o600});renameSync(temp,file);
  };
  return {
    read,
    save(command:unknown,name:unknown) {
      if(typeof command!=='string' || (name!==undefined && (typeof name!=='string' || name.length>100))) throw new Error('Enter a valid SSH command and machine name.');
      const normalized=command.trim();parseSsh(normalized);
      const rows=read();let machine=rows.find(row=>row.command===normalized);
      if (!machine) {machine={id:randomUUID(),name:(name as string)?.trim() || normalized,command:normalized};rows.push(machine);}
      else if (typeof name==='string' && name.trim()) machine.name=name.trim();
      write(rows);return machine;
    },
    remove(id:string) {write(read().filter(row=>row.id!==id));},
  };
}
