import { channels, createGateway, type Channel } from './gateway.ts';
import { laneStatuses, socketFor, startLane, stopLane, waitForLane } from './lanes.ts';
const [command = 'status', name] = process.argv.slice(2);
const port = Number(process.env.REMOTEPAD2_GATEWAY_PORT || 6020);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid gateway port.');
if (command === 'gateway') {
  const server = createGateway({ socket: socketFor, statuses: () => laneStatuses(port), start: (channel) => startLane(channel, port) });
  server.on('error', (error: any) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already occupied. Existing instances were not stopped. Stop the old instance explicitly before moving this entry to the gateway.` : error.message); process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log('RemotePad2: http://127.0.0.1:' + port + '/main/ · /dev/ · /nightly/'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { server.close(); process.exit(0); });
} else if (command === 'status') console.log(JSON.stringify(await laneStatuses(port), null, 2));
else {
  if (!channels.includes(name as Channel)) throw new Error('Choose main, dev or nightly.');
  if (command === 'start') { console.log(await startLane(name as Channel, port)); await waitForLane(name as Channel); console.log('Ready: http://127.0.0.1:' + port + '/' + name + '/'); }
  else if (command === 'stop') await stopLane(name as Channel, port);
  else throw new Error('Usage: pnpm lanes start|stop main|dev|nightly, or pnpm lanes status');
}
