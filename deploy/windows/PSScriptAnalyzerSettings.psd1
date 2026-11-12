# Invoke-ScriptAnalyzer -Path deploy\windows -Settings deploy\windows\PSScriptAnalyzerSettings.psd1
@{
  ExcludeRules = @(
    # Interactive admin scripts: coloured console messages are the point (output is not piped anywhere).
    'PSAvoidUsingWriteHost',
    # Internal helpers inside one-shot admin scripts (New-Secret only returns random text); -WhatIf is not offered.
    'PSUseShouldProcessForStateChangingFunctions',
    # Invoke-Psql takes the database password read from the .env file (plain text there by design, ACL-protected)
    # and hands it to psql through PGPASSWORD, never on a command line; a SecureString would be converted straight back.
    'PSAvoidUsingPlainTextForPassword',
    'PSAvoidUsingUsernameAndPasswordParams',
    # check-machine.ps1 reports each item as Add-Result STATUS 'Item' 'found' 'fix': one line per check reads best.
    'PSAvoidUsingPositionalParameters'
  )
}
