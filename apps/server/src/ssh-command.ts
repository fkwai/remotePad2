export function displayCommand(args: string[]) {
  return args.map(arg=>/^[\w./:@%+=,-]+$/.test(arg)?arg:"'"+arg.replaceAll("'", "'\"'\"'")+"'").join(' ');
}
