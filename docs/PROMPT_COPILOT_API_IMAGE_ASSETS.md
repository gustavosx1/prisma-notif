# Prompt para Copilot — endpoint seguro do catálogo de imagens

Cole este prompt no Copilot Chat aberto no repositório da API Spectrum da VPS. O frontend Prisma Notification Studio já possui a aba **Imagens** e chama o endpoint descrito abaixo. Implemente a integração no estilo real da API; não altere/deploye a VPS sem autorização.

---

Você está no repositório da API Spectrum do Prisma News. Implemente o endpoint de leitura do catálogo curado `public.topic_image_assets` para a aba Imagens do painel administrativo Prisma News.

## Antes de alterar

1. Inspecione framework, estrutura de rotas, autenticação Supabase já usada, mecanismo de autorização administrativa, configuração de banco, migrations, CORS, paginação, testes e deploy.
2. Reutilize os guards/serviços existentes para autenticação e autorização. Não crie outro mecanismo e não assuma nome de coluna de perfil sem verificar o schema e o código existentes.
3. Confirme o contrato esperado pelo cliente neste prompt e no painel. Não exponha a service-role key nem dados privados ao browser.
4. Não aplique migrations destrutivas, não altere políticas RLS e não faça deploy/restart na VPS. Se faltar tabela/índice/permissão, documente a lacuna e proponha migration versionada separada.

## Endpoint a implementar

`GET /notifications/admin/images?entity_type=public_figure&page=1&page_size=24`

- `entity_type` é obrigatório e aceita exclusivamente `public_figure`, `institution` ou `topic`; valor inválido deve retornar `422`.
- `page` é inteiro >= 1. `page_size` é inteiro entre 1 e 100, default 24. Validar e limitar parâmetros conforme convenções atuais.
- Exigir `Authorization: Bearer <Supabase access token>` e aplicar exatamente o mesmo guard compartilhado dos demais endpoints administrativos. O servidor deve validar token e `public.user_profiles.is_admin IS TRUE` para o UUID extraído da identidade validada. Falha de autenticação: `401`; usuário autenticado não-admin: `403`; falha técnica no serviço de autorização: falhar fechado sem consultar ou devolver assets.
- A autorização não pode depender de CORS, da UI nem de dados enviados no body/query. Não criar endpoint público e não aceitar credencial de banco do cliente.

## Consulta e segurança dos dados

- Consultar `public.topic_image_assets` no servidor com o mecanismo/credencial privada já existente. A tabela tem RLS habilitada e acesso revogado para `anon` e `authenticated`; se for indispensável service role, ela só pode permanecer em segredo privado já gerenciado na VPS. Nunca criar variável `NEXT_PUBLIC_*`, incluir segredo no repositório, retornar chave, registrar segredo ou colocá-lo na Vercel.
- Filtrar obrigatoriamente pelo tipo pedido e apenas assets utilizáveis agora:
  - `is_active = true`
  - `valid_from IS NULL OR valid_from <= now()`
  - `valid_until IS NULL OR valid_until > now()`
- Ordenação determinística, por exemplo `display_name ASC, id ASC`.
- Busca de texto não é necessária nesta primeira versão; não implementar filtros SQL arbitrários.
- Retornar só campos de leitura necessários para exibir a imagem, identificar entidade e mostrar a licença/atribuição. Não devolver aliases, dados de perfil, tokens, dados de outros registros, nem campos internos desnecessários.

## Contrato JSON esperado pelo painel

HTTP `200`:

```json
{
  "assets": [
    {
      "id": 123,
      "entity_key": "policia-federal",
      "display_name": "Polícia Federal",
      "image_url": "https://cdn.example/pf.jpg",
      "license_name": "CC BY 4.0",
      "license_url": "https://creativecommons.org/licenses/by/4.0/",
      "source_url": "https://source.example/page",
      "attribution": "Fotógrafa / fonte"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 24,
    "total": 1,
    "total_pages": 1
  }
}
```

- `license_url`, `source_url` e `attribution` podem ser `null` quando ausentes na tabela. `id` pode ser serializado como inteiro JSON; não converter para UUID. Preservar `image_url` exatamente como salvo.
- Página sem resultados deve retornar `200`, `assets: []` e paginação coerente (com `total_pages` pelo menos 1, se essa for a convenção do projeto).
- Não retornar HTML, URLs assinadas com credenciais, URLs privadas, metadados de usuários, nem transformar a consulta em proxy de imagem. Não afirmar que os direitos foram verificados além do que está registrado; os metadados são responsabilidade editorial.

## CORS e operação

- Inspecione o parser real de configuração `API_CORS_ORIGINS`; não presuma formato da variável. Permitir allowlist por origem exata, sem `*` e sem refletir origem arbitrária. Origem de produção atual: `https://prisma-notif.vercel.app` (sem barra final). `http://localhost:3000` só deve permanecer se necessário para desenvolvimento/testes e de acordo com a política operacional.
- Preflight `OPTIONS` deve funcionar sem exigir bearer token. Permitir somente métodos necessários (`GET`, `OPTIONS`) e cabeçalhos `Authorization`, `Content-Type`. CORS não é autorização.
- Manter logs sem access tokens, service-role key, dados pessoais ou URL com segredo. Usar timeouts e erros seguros conforme os padrões existentes.

## Testes obrigatórios

Adicione testes usando a infraestrutura existente, sem depender do Supabase de produção:

1. Sem bearer, bearer malformado, expirado/inválido: `401`; a consulta ao catálogo não ocorre.
2. Usuário autenticado não-admin, perfil inexistente ou `is_admin=false/NULL`: `403`; a consulta não ocorre.
3. Erro/timeout na autorização: fail-closed; a consulta não ocorre.
4. Admin permitido: `200`, esquema esperado e apenas os campos declarados.
5. Tipos aceitos funcionam; tipo inválido, página/tamanho inválido são rejeitados (`422` conforme framework).
6. SQL/repositório filtra tipo, `is_active`, `valid_from` e `valid_until`, pagina e ordena deterministicamente. Cobrir limites/empty page.
7. Origin Vercel permitida funciona no preflight; origem arbitrária não recebe `Access-Control-Allow-Origin`. Confirmar parser e formato efetivo de `API_CORS_ORIGINS`.
8. Resposta e logs não contêm credenciais nem dados de perfil.

Execute testes, lint/typecheck e build que existirem. Não declare pronto para produção se o endpoint/guard não estiver coberto pelos testes.

## Entrega

Informe arquivos alterados, guard reaproveitado, configuração privada necessária (sem revelar valores), formato já suportado para `API_CORS_ORIGINS`, testes executados e qualquer bloqueio de schema/deploy. Não faça commit, push ou deploy sem pedido explícito.
