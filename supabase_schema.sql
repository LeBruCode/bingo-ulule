
create table events (
id serial primary key,
name text not null,
created_at timestamp default now()
);
