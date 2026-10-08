-- 개인 페이지(profile.html)용: 프로필 소개/링크/사진 칸과 프로필 사진 저장소.
-- Supabase 대시보드 → SQL Editor에 통째로 붙여넣고 Run. 여러 번 실행해도 안전하다.

-- 1) profiles에 소개·링크·사진 주소 칸 추가
alter table public.profiles add column if not exists bio text not null default '';
alter table public.profiles add column if not exists link_url text not null default '';
alter table public.profiles add column if not exists avatar_url text;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'profiles_bio_length') then
        alter table public.profiles add constraint profiles_bio_length check (char_length(bio) <= 160);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'profiles_link_length') then
        alter table public.profiles add constraint profiles_link_length check (char_length(link_url) <= 200);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'profiles_display_name_length') then
        alter table public.profiles add constraint profiles_display_name_length check (char_length(display_name) <= 40);
    end if;
end $$;

-- 2) 프로필 사진 저장소: 누구나 볼 수 있고(public), 각자 자기 폴더(avatars/<내 id>/...)에만 올리고 지울 수 있다
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
    allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

drop policy if exists "avatars are public" on storage.objects;
create policy "avatars are public" on storage.objects
    for select using (bucket_id = 'avatars');

drop policy if exists "users upload own avatar" on storage.objects;
create policy "users upload own avatar" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users update own avatar" on storage.objects;
create policy "users update own avatar" on storage.objects
    for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users delete own avatar" on storage.objects;
create policy "users delete own avatar" on storage.objects
    for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
