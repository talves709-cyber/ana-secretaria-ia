// Cria a instância no Evolution com o webhook da Ana e mostra o QR Code no terminal.
// Uso: npm run instancia:criar   (com as variáveis do .env carregadas)
import qrcode from 'qrcode-terminal';
import { Evolution } from '../src/evolution.js';

const exigir = (nome: string) => {
  const v = process.env[nome];
  if (!v) throw new Error(`Defina ${nome} no .env`);
  return v;
};

const evo = new Evolution(exigir('EVOLUTION_URL'), exigir('EVOLUTION_API_KEY'));
const instancia = process.env.EVOLUTION_INSTANCE ?? 'ana';

const r = await evo.criarInstancia(instancia, exigir('WEBHOOK_URL'), exigir('WEBHOOK_TOKEN'));
console.log(`Instância "${instancia}" criada com o webhook configurado.`);
if (r.qrcode?.code) {
  console.log('\nNo celular: WhatsApp > Aparelhos conectados > Conectar aparelho\n');
  qrcode.generate(r.qrcode.code, { small: true });
} else {
  console.log('Rode "npm run qrcode" para ver o QR Code.');
}
