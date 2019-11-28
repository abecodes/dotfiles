function deletedockerbuildsteps
  docker rmi -f (docker images | awk '{print $1,$3}' | grep 'none' | awk '{print $2}')
end
