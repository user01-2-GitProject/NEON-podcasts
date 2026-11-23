alter table episodes add column if not exists audio_content_type text not null default 'audio/mpeg';
update episodes e set audio_content_type = ea.content_type
from episode_audio ea where ea.episode_id = e.id;
