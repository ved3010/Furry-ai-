[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Speech

try {
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $recognizer.SetInputToDefaultAudioDevice()

    $culture = $recognizer.RecognizerInfo.Culture.Name

    $staticChoices = New-Object System.Speech.Recognition.Choices
    $dynamicPrefixes = New-Object System.Speech.Recognition.Choices

    if ($culture.StartsWith("ko")) {
        $staticChoices.Add(@("키투", "킷투", "콤냥이", "코냥이", "멈춰", "정지", "그만", "키투 멈춰", "키투 정지", "키투 그만", "콤냥이 멈춰", "콤냥이 정지", "콤냥이 그만"))
        $dynamicPrefixes.Add(@("키투 재생", "키투 틀어", "키투 들려줘", "키투", "재생", "틀어", "들려줘", "콤냥이 재생", "콤냥이 틀어", "콤냥이 들려줘", "콤냥이"))
    } else {
        $staticChoices.Add(@("kittu", "hey kittu", "gittu", "kitty", "kito", "get to", "kit to", "key to", "git to", "into", "digital"))
        $staticChoices.Add(@("kittu stop", "hey kittu stop", "gittu stop", "kitty stop", "kito stop", "get to stop", "kit to stop", "key to stop", "git to stop", "into stop", "digital stop"))
        $staticChoices.Add(@("kittu pause", "hey kittu pause", "gittu pause", "kitty pause", "kito pause", "get to pause", "kit to pause", "key to pause", "git to pause", "into pause", "digital pause"))
        $staticChoices.Add(@("stop", "pause", "stop music", "pause music"))
        
        $dynamicPrefixes.Add(@("kittu play", "hey kittu play", "gittu play", "kitty play", "kito play", "get to play", "kit to play", "key to play", "git to play", "into play", "digital play"))
        $dynamicPrefixes.Add(@("kittu", "hey kittu", "gittu", "kitty", "kito", "get to", "kit to", "key to", "git to", "into", "digital"))
        $dynamicPrefixes.Add(@("play"))
    }

    $staticGrammar = New-Object System.Speech.Recognition.Grammar($staticChoices)
    $recognizer.LoadGrammar($staticGrammar)

    $gb = New-Object System.Speech.Recognition.GrammarBuilder
    $gb.Append($dynamicPrefixes)
    $gb.AppendDictation()
    $dynamicGrammar = New-Object System.Speech.Recognition.Grammar($gb)
    $recognizer.LoadGrammar($dynamicGrammar)

    # Signal to parent process that we started successfully
    [Console]::WriteLine("LISTENER_READY")

    while ($true) {
        try {
            $result = $recognizer.Recognize()
            if ($result -ne $null -and $result.Text.Trim() -ne "") {
                [Console]::WriteLine($result.Text.Trim())
            }
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
} catch {
    [Console]::WriteLine("LISTENER_ERROR: " + $_.Exception.Message)
}
