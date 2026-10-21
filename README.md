# Prisma News — Notification Studio

Painel web independente para administradores consultarem tópicos publicados e solicitarem envios manuais de push. O frontend usa Supabase Auth no navegador e chama a API Spectrum diretamente com o access token. A API permanece como autoridade de autenticação/autorização para recursos administrativos.

## Requisitos e configuração local

- Node.js 20.9+ e npm
- Projeto Supabase Auth existente do Prisma News (não crie outro projeto)
- API Spectrum acessível via HTTPS e configurada para CORS

1. Copie `.env.example` para `.env.local`.
2. Preencha somente estas variáveis públicas apontando para o mesmo projeto Supabase usado pelo Prisma News:
   - `NEXT_PUBLIC_SPECTRUM_API_URL`: URL base da API Spectrum, sem barra final nem prefixo de endpoint.
   - `NEXT_PUBLIC_SUPABASE_URL`: URL pública do projeto Supabase.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: chave anon/public do Supabase (nunca use service role).
   - `NEXT_PUBLIC_NOTIFICATION_TITLE_LIMIT` e `NEXT_PUBLIC_NOTIFICATION_BODY_LIMIT`: limites de caracteres da interface; configure com os valores efetivamente validados pela API Spectrum. Os valores `120`/`240` do `.env.example` são defaults de interface e precisam ser confirmados antes do deploy.
3. Execute `npm install` e inicie com `npm run dev`.
4. Abra `http://localhost:3000`.

O painel oferece somente login por email e senha; não oferece signup, convite ou criação de usuários. A sessão é mantida pelo cliente oficial `@supabase/supabase-js` com persistência e renovação automática. Após autenticar, o painel chama o RPC `is_current_user_admin()` no projeto existente; apenas `true` libera a interface. As chamadas de tópicos, dispatch e status partem do browser diretamente para a API, com `Authorization: Bearer <access token>`.

## Segurança e autorização

- O browser recebe somente a URL e a anon key do Supabase e a URL pública da API.
- Nunca configure `service_role`, tokens Expo, credenciais privilegiadas ou segredos de API em `NEXT_PUBLIC_*`, no frontend ou em armazenamento do browser.
- O bloqueio do painel por `is_admin` é uma checagem de interface e **não é suficiente para proteger os endpoints**. A API Spectrum deve validar assinatura/expiração do JWT, ler o `sub` UUID e consultar `public.user_profiles.is_admin` no projeto Prisma News no servidor, antes de executar cada endpoint administrativo. Se a API não fizer essa validação server-side, um usuário pode ignorar a interface e chamar a API diretamente. Não confie em email, user metadata ou numa checagem feita somente pelo navegador.
- A API deve continuar revalidando tópico elegível, idempotência, rate limit e autorização no dispatch. A interface não substitui esses controles.
- Configure CORS na API com origens exatas: domínio de produção do painel, por exemplo `https://admin.prismanews.com`, e origens locais necessárias durante desenvolvimento, como `http://localhost:3000`. Não habilite wildcard em produção. Permita `Authorization`, `Content-Type`, `Idempotency-Key` e métodos `GET`, `POST`, `OPTIONS`; exponha somente os headers de resposta necessários.
- Em produção use HTTPS para Vercel, API e Supabase. Não registre tokens ou payloads sensíveis em logs.

## Migração e provisionamento manual da equipe

1. A migration em `supabase/migrations/20261021000000_user_profiles_is_admin.sql` adiciona `is_admin boolean not null default false`, cria o RPC `is_current_user_admin()` e bloqueia que sessões autenticadas comuns definam ou alterem essa flag. Ela assume que `public.user_profiles.id` referencia `auth.users.id`. Se a chave da tabela no seu projeto se chama `user_id` ou tem outro nome, ajuste a condição da função antes de aplicar.
2. Aplique a migration ao projeto Supabase **existente** do Prisma News pelo fluxo de migrations já usado pela equipe (ou SQL Editor após revisão). Não crie outro projeto Supabase.
3. Um operador autorizado cria cada conta em Supabase Dashboard → Authentication → Users, com signup público desabilitado.
4. Um operador privilegiado marca o perfil correspondente com `is_admin = true` por um processo seguro no servidor/SQL. Não exponha a edição dessa coluna ao usuário comum. O default é `false`.
5. Configure a API Spectrum para consultar a mesma flag server-side e retornar 403 para qualquer JWT autenticado cujo UUID não tenha perfil administrador. Remover `is_admin` revoga a autorização nos próximos requests.
6. Entregue acesso/credenciais por processo interno seguro e valide um usuário permitido e outro não permitido. Não há página de cadastro no painel.

O trigger da migration rejeita tentativas de inserir ou alterar `is_admin` pelas roles `anon` e `authenticated`; mudanças devem passar pelo procedimento administrativo de confiança. A RPC retorna somente o booleano do usuário autenticado atual e não concede acesso aos demais dados do perfil.

## Deploy na Vercel

1. Importe o projeto na Vercel e use o preset Next.js. Build command: `npm run build`; output padrão Next.js.
2. Configure em produção (e em Preview somente se aprovado): `NEXT_PUBLIC_SPECTRUM_API_URL`, `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Adicione o domínio de produção do painel às origens CORS permitidas pela API. Adicione origens Preview somente se necessário; prefira restringi-las ou usar ambiente de API não produtivo.
4. No Supabase, configure site URL/redirect URLs conforme o domínio real se os fluxos de Auth do projeto exigirem. O painel usa email/senha e não implementa signup.
5. Faça deploy e teste com conta `is_admin=true`, conta `is_admin=false` (deve ver acesso negado e receber 403 nos endpoints) e sessão expirada.

## Comportamento do painel

- A API fornece apenas tópicos elegíveis (`is_hot=true` e `initial_check=true`) e revalida elegibilidade ao disparar.
- Busca e paginação usam `GET /notifications/admin/topics?page=1&page_size=25&search=`.
- A confirmação permite revisar título e corpo respeitando `NEXT_PUBLIC_NOTIFICATION_TITLE_LIMIT`/`NEXT_PUBLIC_NOTIFICATION_BODY_LIMIT`; os defaults do exemplo devem ser alinhados com os limites efetivos documentados pela API antes do deploy.
- O título oferece sugestões selecionáveis, como “Saiba mais!”, “Veja todas as perspectivas”, “Entenda o que está acontecendo” e “Confira os principais detalhes”. O corpo é preenchido com o título completo da matéria e fica somente leitura. Se esse título ultrapassar o limite de corpo configurado, o painel bloqueia o envio em vez de truncar o texto.
- A audiência é fixa: todos os tokens de dispositivo ativos registrados no app, sem segmentação por pessoa ou status Premium.
- A imagem é selecionada pelo worker a partir de até três sujeitos centrais sugeridos pela IA e da primeira correspondência ativa no catálogo.
- Cada confirmação cria um `Idempotency-Key` novo. Em erro/timeout, “Repetir a mesma solicitação” conserva o mesmo corpo e chave; não inicie outra confirmação para repetir a mesma ação.
- Depois de HTTP 202, o status é consultado a cada 3 segundos enquanto não terminal. Estados, aceitos/rejeitados e receipts são exibidos sem listar destinatários ou tokens Expo. Aceitação pelo Expo não garante exibição no aparelho.

## Validação

- `npm run lint`
- `npm run build`

Os testes de integração da API devem verificar validação do JWT, consulta de `user_profiles.is_admin` e idempotência. HTTP 403 e prevenção de duplicidade são responsabilidades da API Spectrum; não podem ser garantidos somente pelo frontend.

O prompt para instruir o Copilot no repositório da API da VPS está em `docs/PROMPT_COPILOT_API_ADMIN_NOTIFICATIONS.md`.

### Checklist de teste ponta a ponta

Execute em um ambiente de homologação com uma conta criada manualmente e tópicos/dispatch de teste:

1. **Sem sessão:** abra o painel em janela privada; confirme que somente o formulário de login aparece e nenhuma chamada administrativa é feita.
2. **Login/logout:** entre com conta válida; confirme listagem e que logout retorna à tela de login e limpa o conteúdo.
3. **Sessão expirada:** revogue/expire a sessão e provoque uma chamada; HTTP 401 deve encerrar a sessão local e voltar ao login.
4. **Admin:** use uma conta com `is_admin=false`; o RPC deve negar acesso, a interface não deve listar tópicos e os endpoints devem responder 403 mesmo se chamados diretamente. Repita com `is_admin=true`.
5. **Lista, pesquisa e paginação:** confira loading, vazio, erro HTTP/retry, busca por texto e navegação entre páginas de 25 resultados.
6. **Confirmação:** selecione tópico, revise título/corpo, confirme audiência fixa e regras de imagem; confira os limites sincronizados com a API.
7. **Clique duplo/retry:** clique confirmar rapidamente e confira que há uma única requisição ativa. Simule timeout e use repetir; o `Idempotency-Key` e corpo devem ser os mesmos. Envie nova ação intencional e confira chave nova.
8. **Dispatch:** valide HTTP 202, polling, transições `queued`/`sending`/`sent` ou `failed`, contagens e receipts; feche/navegue e confirme cancelamento do polling.
9. **Privacidade:** inspecione respostas, console, storage e tela; nenhum destinatário individual, token Expo, service role ou segredo deve aparecer.

A validação automatizada neste repositório cobre lint e build. Os passos acima exigem credenciais e API Spectrum reais/homologação; não foram executados automaticamente neste workspace.
