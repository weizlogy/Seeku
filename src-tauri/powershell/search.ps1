param (
  [string]$query
)

$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# クエリの中のシングルクォートをエスケープして、ちょっぴり安全にするよ！ (<em>´艸｀</em>)
$escapedQuery = $query.Replace("'", "''")

# SystemIndex（Windows Search）に問い合わせ
$searchQuery = "SELECT System.ItemUrl, System.ItemName FROM SYSTEMINDEX WHERE System.ItemName LIKE '%$escapedQuery%'"

# COM経由で接続
$conn = New-Object -ComObject ADODB.Connection
$conn.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
$rs = $conn.Execute($searchQuery)

# 結果をJSONで出力
$result = @()
while (!$rs.EOF) {
  $path = $rs.Fields.Item("System.ItemUrl").Value
  $name = $rs.Fields.Item("System.ItemName").Value
  $result += [PSCustomObject]@{
    Path = $path
    Name = $name
  }
  $rs.MoveNext()
}

# JSON形式で標準出力に
$result | ConvertTo-Json -Compress
