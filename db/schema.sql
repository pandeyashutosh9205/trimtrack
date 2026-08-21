create table urls(
    id serial primary key,
    short_code varchar(20) unique not null,
    long_url text not null,
    created_at timestamptz not null default now()
);
