// Configuração da nuvem (Supabase).
// A chave abaixo é a chave PÚBLICA (anon/publishable): pode ficar no app, pois o acesso
// aos dados é protegido por login + regras de segurança por linha (RLS) no banco.
// NUNCA coloque aqui a chave secreta (service_role / secret).
// Com os dois campos vazios, o app funciona 100% local, sem sincronização.
export const SUPABASE_URL = 'https://dwsogzjdnfklocwlaqnf.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_TMOlyXIOsinCRu8pZjioog_Df7SqDTr';
