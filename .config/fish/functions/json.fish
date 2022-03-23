function json
  if isatty stdin
      set inc "$argv"
  else
    while read line
      set --append inc "$line"
    end
  end
  
  jq -n "($inc)"
end
