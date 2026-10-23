// Mostra o QR Code atual da instância (o Evolution renova o código sozinho quando expira).
// Uso: npm run qrcode
import qrcode from 'qrcode-terminal';
import { Evolution } from '../src/evolution.js';

const evo = new Evolution(process.env.EVOLUTION_URL ?? '', process.env.EVOLUTION_API_KEY ?? '');
const instancia = process.env.EVOLUTION_INSTANCE ?? 'ana';

const estado = await evo.estado(instancia);
if (estado === 'open') {
  console.log(`A instância "${instancia}" já está conectada.`);
} else {
  const r = await evo.conectar(instancia);
  if (!r.code) throw new Error('O Evolution não devolveu QR Code. Confira se a instância existe.');
  console.log('\nNo celular: WhatsApp > Aparelhos conectados > Conectar aparelho\n');
  qrcode.generate(r.code, { small: true });
  if (r.pairingCode) console.log(`Ou use o código de pareamento: ${r.pairingCode}`);
}
