# Prompt para Copilot — proteger endpoints administrativos de notificações na VPS

Cole o prompt abaixo no Copilot Chat aberto no repositório da API Spectrum que está implantado na VPS do Prisma News. O frontend já usa o mesmo Supabase Auth do Prisma News e consulta `public.user_profiles.is_admin`; a autorização real dos endpoints precisa acontecer nesta API, no servidor.

---

Você está trabalhando no repositório da API Spectrum executada na VPS do Prisma News. Faça os endpoints administrativos de notificações ficarem seguros e prontos para produção, usando a coluna `public.user_profiles.is_admin` do projeto Supabase existente do Prisma News como fonte de autorização.

## Antes de alterar código

1. Inspecione o repositório inteiro o suficiente para identificar framework, configuração de deploy na VPS (systemd/Docker/Compose/etc.), endpoints atuais, validação JWT, cliente/banco Supabase, migrations, fila Celery/worker, CORS, rate limit, auditoria e testes.
2. Leia a migration do painel `supabase/migrations/20261021000000_user_profiles_is_admin.sql` se ela estiver disponível neste workspace/contexto. Ela pressupõe que `public.user_profiles.id` referencia `auth.users.id`. **Verifique o schema real** e, se a coluna de associação tiver outro nome, adapte a integração ao nome real sem criar uma tabela paralela nem assumir uma relação inexistente.
3. Preserve os contratos existentes dos endpoints e o comportamento de push/navegação do app. Não faça alterações destrutivas ou deploy/restart em produção sem explicar o plano e obter confirmação.
4. Faça um plano breve e implemente no estilo existente do repositório. Não invente variáveis, endpoints, estados ou formatos de resposta incompatíveis com o código real.

## Regra obrigatória de autenticação/autorização

- Proteja **todos** os endpoints em `/notifications/admin/*`, inclusive leitura de tópicos, criação de dispatch e consulta de status; não confie em proteção somente no frontend, em URL obscura, email, `user_metadata`, headers de identidade enviados pelo cliente ou flag local.
- Exija `Authorization: Bearer <Supabase access token>`. Ausente, malformado, expirado, inválido ou assinado por emissor/projeto inesperado deve resultar em HTTP 401 sem executar lógica administrativa.
- Valide o token por método confiável do projeto Supabase Auth (por exemplo, `auth.getUser(access_token)` ou middleware validado equivalente já usado pelo projeto). Não decodifique JWT sem verificar criptograficamente assinatura, issuer, audience e expiração. Compatibilize com o algoritmo/chaves de assinatura configurados no projeto atual.
- Obtenha o UUID autenticado (`sub`/user id) **do token validado**, nunca do body/query/header. Consulte no servidor o perfil correspondente em `public.user_profiles` e permita apenas se `is_admin IS TRUE`. UUID ausente, perfil ausente, flag `false`/NULL, erro de consulta, timeout ou falha de configuração devem falhar fechados: HTTP 403 para não-admin e resposta segura de erro/indisponibilidade para falhas técnicas, sem prosseguir com a ação.
- Use credencial de servidor (service role ou conexão de banco com privilégio mínimo) apenas em variável privada do processo da VPS. Nunca a coloque em código versionado, resposta, logs, frontend, Vercel, `.env.example` nem variável `NEXT_PUBLIC_*`. Não retorne dados de perfil ao usuário além do resultado necessário para autorização.
- Se houver cache de autorização, remova-o ou defina TTL muito curto e invalidação que garanta revogação rápida após `is_admin` ser desativado. Não cacheie indefinidamente essa permissão.
- A verificação deve ocorrer dentro de middleware/dependency/guard compartilhado, antes dos handlers. Não duplicar implementação inconsistente endpoint a endpoint.

## Endpoints e semântica a preservar

### Listagem

`GET /notifications/admin/topics?page=1&page_size=25&search=`

- Retorne somente tópicos elegíveis e publicados, de acordo com a regra de domínio vigente (`is_hot=true` e `initial_check=true`).
- Validar/padronizar `page`, `page_size` e `search`; limitar o tamanho de página e o comprimento de busca para proteção contra abuso.
- Retornar apenas os campos necessários à UI (id, título, resumo curto, data, contagem de artigos e paginação). Não retornar tokens, perfis, dados internos, conteúdo não elegível ou dados privados dos destinatários.

### Solicitação de dispatch

`POST /notifications/admin/dispatches`

- Exigir header `Idempotency-Key` bem formado e de tamanho limitado, único por ação intencional. Persistir a chave com restrição única e escopo apropriado (por exemplo, usuário autenticado + chave/rota), de forma transacional e concorrente-safe; a mesma chave e mesmo payload deve retornar o resultado/dispatch original sem enfileirar novamente. A mesma chave com payload diferente deve retornar conflito HTTP 409. Não depender de deduplicação somente em memória.
- Validar JSON estritamente: `topic_id` válido, strings title/body dentro dos limites reais documentados e rejeição de campos/formatos inválidos. Revalidar a elegibilidade do tópico dentro da operação para evitar envio de tópico que deixou de ser elegível depois da listagem.
- Manter audiência fixa: todos os tokens de dispositivos ativos registrados no app. Não implementar segmentação por pessoa, status Premium ou filtros fornecidos pelo cliente.
- Gravar auditoria server-side com UUID do admin autenticado, tópico, dispatch id, resultado e timestamps. Não gravar access token, token Expo ou segredos.
- Aplicar rate limit por identidade/autorização e proteção contra abuso sem prejudicar idempotência; responder `429` e `Retry-After` quando apropriado.
- Criar dispatch e enfileirar tarefa de forma confiável (transactional outbox ou padrão consistente já existente) para não retornar aceito sem trabalho durável. Manter resposta `202` e contrato atual com `dispatch_id` e estado inicial quando possível.
- Worker deve usar os tokens Expo ativos já registrados e manter formato/tipo de notificação e navegação compatíveis com o app. Nunca aceitar lista de tokens/destinatários enviada pelo painel.

### Consulta de status

`GET /notifications/admin/dispatches/{dispatch_id}`

- Aplicar o mesmo guard de autenticação e `is_admin`.
- Validar id e limitar acesso ao dispatch conforme o modelo de autorização do projeto; não expor dispatches/dados arbitrários sem autorização.
- Retornar somente estado (`queued`, `sending`, `sent`, `failed` conforme contrato), contagens aceitas/rejeitadas e resumo/estado agregado dos receipts.
- Nunca devolver tokens Expo, identificadores individuais de destinatários, mapa interno de receipts ou credenciais. Redigir erros internos antes de responder.
- Não afirmar que aceito pelo Expo significa que a notificação foi exibida no aparelho.

## CORS, erros e operação na VPS

- Configure CORS por allowlist de origens exatas: domínio HTTPS de produção do painel Prisma News e origens locais estritamente necessárias (`http://localhost:3000` em desenvolvimento). Não use `*` em produção nem reflita qualquer `Origin` arbitrário.
- Permita apenas métodos necessários (`GET`, `POST`, `OPTIONS`) e headers (`Authorization`, `Content-Type`, `Idempotency-Key`). CORS não substitui autenticação.
- Use respostas consistentes: 401 para credencial ausente/inválida, 403 para autenticado não admin, 404 para recursos inexistentes/indisponíveis conforme a política contra enumeração, 409 para conflito de idempotência, 422 para validação e 429 para rate limit. Não enviar stack trace, query SQL, configuração ou segredo ao cliente.
- Verifique TLS/reverse proxy, limites de request/body, timeouts, health/readiness check, dependências e restart policy conforme o deploy existente. Segredos da VPS devem vir do mecanismo privado atual, com permissões restritas; não escrever segredos em logs ou comandos de deploy.
- Não faça migrações destrutivas nem altere a tabela de perfis sem migration versionada, revisão e plano de backup/rollback.

## Testes exigidos

Adicione/atualize testes automatizados para provar:

1. Sem token, token inválido/expirado e issuer/projeto errado: HTTP 401; nenhum handler/worker é executado.
2. Token válido com UUID não encontrado, perfil ausente, `is_admin=false`/NULL: HTTP 403 em cada endpoint administrativo e nenhuma operação lateral.
3. Token válido com `is_admin=true`: acesso autorizado nos endpoints.
4. Falha/timeout ao consultar Supabase: fail closed e sem disparo.
5. Listagem exclui tópico não elegível e limita paginação/entrada de busca.
6. Revalidação rejeita tópico que deixou de ser elegível.
7. Duas requisições concorrentes com mesma chave/payload produzem um dispatch e um enfileiramento; chave repetida com payload diferente retorna 409.
8. Rate limit, auditoria sem segredos, resposta/status sem tokens ou mapa de recipients, e CORS para origem aprovada e não aprovada.
9. Worker preserva payload/navegação compatíveis e destinatários são derivados somente dos tokens ativos já registrados.

Execute os testes, lint/typecheck e build disponíveis. Corrija regressões causadas pelas mudanças. Se não houver infraestrutura/testes para algum cenário, documente explicitamente o que foi e não foi validado.

## Entrega

- Resuma arquivos alterados, como o guard consulta `is_admin`, configurações privadas necessárias na VPS e comandos reais de testes/deploy encontrados no repositório.
- Documente migrações, CORS, variáveis privadas, procedimento para ativar/desativar um admin e rollback.
- Liste riscos/bloqueios restantes. Não declare produção segura até confirmar que os endpoints reais usam o guard e que os testes de 401/403/idempotência passaram.
