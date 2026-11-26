-- Days a show airs when cadence = 'days' (ISO weekdays: 1 = Monday ... 7 = Sunday).
alter table shows add column if not exists air_days smallint[];
