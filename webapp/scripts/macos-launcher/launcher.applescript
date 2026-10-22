on run
    try
        set resourcePath to (POSIX path of (path to me)) & "Contents/Resources/"
        with timeout of 60 seconds
            do shell script quoted form of (resourcePath & "launch.sh")
        end timeout
    on error errorMessage
        display dialog errorMessage with title "IboView 启动失败" buttons {"好"} default button "好" with icon caution
    end try
end run
