-- 사용자별 감각 검색용: 핀 이미지 분석 결과와, 감각 테스트에서 고른/안 고른 핀 기록.
-- Supabase 대시보드 → SQL Editor에 통째로 붙여넣고 Run. 여러 번 실행해도 안전하다.

-- 1) 핀 이미지 분석 결과 (브라우저가 SigLIP 2 이미지 모델로 계산해서 올린다)
--    vector: 길이를 1로 맞춘 768차원 벡터를 -127~127 정수로 줄여 base64로 담은 문자열 (핀 하나에 약 1KB)
--    model: 어떤 모델·정밀도로 계산했는지 (예: siglip2-base-224/fp16) - 모델이 바뀌면 다시 계산하는 기준
create table if not exists public.pin_embeddings (
    pin_id uuid primary key references public.pins(id) on delete cascade,
    owner_id uuid not null references auth.users(id) on delete cascade,
    model text not null,
    vector text not null,
    created_at timestamptz not null default now()
);
create index if not exists pin_embeddings_owner_idx on public.pin_embeddings(owner_id);

alter table public.pin_embeddings enable row level security;

-- 다른 사람이 그 사람 터널에서 검색할 때도 쓰이므로 읽기는 공개, 쓰기는 자기 핀만
drop policy if exists "embeddings are readable" on public.pin_embeddings;
create policy "embeddings are readable" on public.pin_embeddings for select using (true);

drop policy if exists "users write own embeddings" on public.pin_embeddings;
create policy "users write own embeddings" on public.pin_embeddings
    for insert to authenticated
    with check (owner_id = auth.uid() and exists (select 1 from public.pins p where p.id = pin_id and p.owner_id = auth.uid()));

drop policy if exists "users update own embeddings" on public.pin_embeddings;
create policy "users update own embeddings" on public.pin_embeddings
    for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "users delete own embeddings" on public.pin_embeddings;
create policy "users delete own embeddings" on public.pin_embeddings
    for delete to authenticated using (owner_id = auth.uid());

-- 2) 감각 테스트 기록: 단어마다 보여준 핀을 고르면 2(맞아), 안 고르면 0(아니야)
--    고른 핀만이 아니라 안 고른 핀까지 남겨야 "그 사람의 경계"를 학습해서 테스트에 안 나온 핀에도 적용할 수 있다
create table if not exists public.taste_marks (
    owner_id uuid not null references auth.users(id) on delete cascade,
    word text not null check (char_length(word) between 1 and 30),
    pin_id uuid not null references public.pins(id) on delete cascade,
    value smallint not null check (value in (0, 2)),
    updated_at timestamptz not null default now(),
    primary key (owner_id, word, pin_id)
);
create index if not exists taste_marks_owner_idx on public.taste_marks(owner_id);

alter table public.taste_marks enable row level security;

drop policy if exists "taste marks are readable" on public.taste_marks;
create policy "taste marks are readable" on public.taste_marks for select using (true);

drop policy if exists "users write own taste marks" on public.taste_marks;
create policy "users write own taste marks" on public.taste_marks
    for insert to authenticated
    with check (owner_id = auth.uid() and exists (select 1 from public.pins p where p.id = pin_id and p.owner_id = auth.uid()));

drop policy if exists "users update own taste marks" on public.taste_marks;
create policy "users update own taste marks" on public.taste_marks
    for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "users delete own taste marks" on public.taste_marks;
create policy "users delete own taste marks" on public.taste_marks
    for delete to authenticated using (owner_id = auth.uid());

-- 3) 사이트(anon = 로그인 안 한 방문자, authenticated = 로그인한 사용자)가 이 테이블을 쓸 수 있게 권한을 준다.
--    누가 어떤 행을 읽고 쓸 수 있는지는 위의 정책(RLS)이 정한다. 새 테이블에 권한이 자동으로 붙지 않는 프로젝트가 있다
grant select on public.pin_embeddings, public.taste_marks to anon, authenticated;
grant insert, update, delete on public.pin_embeddings, public.taste_marks to authenticated;
-- 관리용 스크립트(서비스 키 - 기본 아카이브 핀 일괄 분석, 실사이트 점검)가 쓸 수 있게
grant all on public.pin_embeddings, public.taste_marks to service_role;

-- 4) Supabase API가 새 테이블을 바로 알아보도록 테이블 목록(schema cache)을 새로 읽게 한다
notify pgrst, 'reload schema';
