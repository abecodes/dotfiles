function yt2mp3
  yt-dlp -i --extract-audio --audio-format 'mp3' $argv
end
