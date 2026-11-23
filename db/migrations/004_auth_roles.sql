alter table users add column if not exists password_hash text;
alter table users add column if not exists role text not null default 'member' check (role in ('owner', 'member'));
alter table users add column if not exists owner_approved boolean not null default false;
