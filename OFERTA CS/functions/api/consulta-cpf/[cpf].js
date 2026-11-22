import { cfg, consultarCpf } from '../../_lib.js';

export async function onRequestGet(context) {
  const cpf = String(context.params.cpf || '').replace(/\D/g, '');
  return consultarCpf(cfg(context.env), cpf);
}