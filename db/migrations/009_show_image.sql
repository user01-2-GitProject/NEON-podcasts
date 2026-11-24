-- Per-show artwork: an http(s) image URL shown in the apps and as <itunes:image> in RSS.
alter table shows add column if not exists image_url text;
