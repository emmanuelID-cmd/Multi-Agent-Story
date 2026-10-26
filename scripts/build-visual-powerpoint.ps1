param([string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$source = Join-Path $ProjectRoot 'docs/artifacts/read-agent-team-alignment.pptx'
$output = Join-Path $ProjectRoot 'docs/artifacts/story-builder-visual-v3.pptx'
$show = Join-Path $ProjectRoot 'docs/artifacts/story-builder-visual-v3.ppsx'
$diagram = Join-Path $ProjectRoot 'docs/architecture/assets/flow-architecture-v3.svg'
$diagramData = Get-Content (Join-Path $ProjectRoot 'docs/architecture/assets/flow-architecture-v3.json') -Raw | ConvertFrom-Json
$content = Get-Content (Join-Path $ProjectRoot 'docs/artifacts/story-builder-visual-v3-slides.json') -Raw | ConvertFrom-Json
$qa = Join-Path $ProjectRoot '.tools/visual-powerpoint'
if (!(Test-Path $source) -or !(Test-Path $diagram)) { throw 'Required source deck or architecture map is missing.' }
if ((Test-Path $output) -or (Test-Path $show)) { throw 'Visual output exists; this build only creates new artifacts.' }
New-Item -ItemType Directory -Path $qa -Force | Out-Null
$sourceHash = (Get-FileHash $source -Algorithm SHA256).Hash
function RGB([string]$hex) { $h=$hex.TrimStart('#'); return ([Convert]::ToInt32($h.Substring(0,2),16) + 256*[Convert]::ToInt32($h.Substring(2,2),16) + 65536*[Convert]::ToInt32($h.Substring(4,2),16)) }
$C = @{ navy=(RGB '#0B1220'); cream=(RGB '#F7F4EC'); cyan=(RGB '#53D9E9'); violet=(RGB '#AA91FF'); blue=(RGB '#76A8FF'); amber=(RGB '#F4BC6C'); muted=(RGB '#9AAAC3'); panel=(RGB '#18253B'); panel2=(RGB '#22324A'); green=(RGB '#A6E8C0'); red=(RGB '#F69A9A') }
function Box($s,[double]$x,[double]$y,[double]$w,[double]$h,[int]$fill,[double]$radius=0) {
  $type=1; if($radius -gt 0){$type=5}
  $q=$s.Shapes.AddShape($type,$x,$y,$w,$h);$q.Fill.ForeColor.RGB=$fill;$q.Line.Visible=0
  if($radius -gt 0){try{$q.Adjustments.Item(1)=$radius}catch{}}
  return $q
}
function Text($s,[string]$value,[double]$x,[double]$y,[double]$w,[double]$h,[double]$size,[int]$color,[bool]$bold=$false,[int]$align=1) {
  try {$q=$s.Shapes.AddTextbox(1,$x,$y,$w,$h)} catch {throw ("AddTextbox failed at x=$x y=$y w=$w h=$h text=$value : "+$_.Exception.Message)}
  $q.TextFrame.AutoSize=0;$q.TextFrame.WordWrap=-1
  $q.TextFrame.MarginLeft=0;$q.TextFrame.MarginRight=0;$q.TextFrame.MarginTop=0;$q.TextFrame.MarginBottom=0
  $q.TextFrame.TextRange.Text=$value
  $q.TextFrame.TextRange.Font.Name='Inter';$q.TextFrame.TextRange.Font.Size=$size
  $q.TextFrame.TextRange.Font.Color.RGB=$color;$q.TextFrame.TextRange.Font.Bold=[int]$bold
  $q.TextFrame.TextRange.ParagraphFormat.Alignment=$align
  return $q
}
function Rule($s,[double]$x1,[double]$y1,[double]$x2,[double]$y2,[int]$color,[double]$weight=2) {
  $q=$s.Shapes.AddLine($x1,$y1,$x2,$y2);$q.Line.ForeColor.RGB=$color;$q.Line.Weight=$weight;return $q
}
function Circle($s,[double]$cx,[double]$cy,[double]$r,[int]$color) {
  $q=$s.Shapes.AddShape(9,($cx-$r),($cy-$r),(2*$r),(2*$r));$q.Fill.ForeColor.RGB=$color;$q.Line.Visible=0;return $q
}
function Link($shape,$target) {
  $a=$shape.ActionSettings.Item(1);$a.Action=7;$a.Hyperlink.Address='';$a.Hyperlink.SubAddress=('{0},{1},{2}' -f $target.SlideID,$target.SlideIndex,$target.Name)
}
function Nav($s,[int]$i,$deck) {
  $null=Rule $s 40 498 920 498 $C.panel2 1
  if($i -gt 1){$q=Text $s '←  PREVIOUS' 40 510 120 20 11 $C.muted;Link $q $deck.Slides.Item($i-1)}
  $q=Text $s 'SYSTEM MAP' 410 510 140 20 11 $C.cyan $true 2;Link $q $deck.Slides.Item(2)
  if($i -lt 10){$q=Text $s 'NEXT  →' 820 510 100 20 11 $C.muted $false 3;Link $q $deck.Slides.Item($i+1)}
  $null=Text $s ([string]$i).PadLeft(2,'0') 470 16 40 18 10 $C.muted $false 2
}
function Header($s,$d,[int]$i,[int]$accent) {
  $null=Text $s $d.kicker 42 28 340 20 12 $accent $true
  $null=Text $s $d.title 42 58 865 56 30 $C.cream $true
  $null=Text $s $d.subtitle 44 119 860 45 15 $C.muted
}
function Pill($s,[string]$label,[double]$x,[double]$y,[double]$w,[int]$accent,[double]$font=13) {
  $null=Box $s $x $y $w 38 $C.panel 0.18
  $null=Box $s $x $y 4 38 $accent
  return (Text $s $label ($x+15) ($y+9) ($w-25) 24 $font $C.cream $true)
}
function Card($s,[string]$n,[string]$title,[string]$detail,[double]$x,[double]$y,[double]$w,[double]$h,[int]$accent) {
  $null=Box $s $x $y $w $h $C.panel 0.12
  $null=Box $s $x $y 5 $h $accent
  $null=Text $s $n ($x+20) ($y+15) ($w-40) 22 12 $accent $true
  $titleHeight=40;$detailY=90;$detailHeight=$h-105
  if($h -ge 180){$titleHeight=61;$detailY=110;$detailHeight=$h-120}
  $null=Text $s $title ($x+20) ($y+43) ($w-40) $titleHeight 21 $C.cream $true
  if($detail){$null=Text $s $detail ($x+20) ($y+$detailY) ($w-40) $detailHeight 14 $C.muted}
}
function Notes($s,[string]$note) {
  try {$s.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text=$note}catch{}
}
function Add-Motion($slide,$dot,[array]$segments,[double]$originX,[double]$originY) {
  $effect=$slide.TimeLine.MainSequence.AddEffect($dot,0,0,2)
  $effect.Timing.RepeatCount=999
  $elapsed=0.0;$count=0
  foreach($seg in $segments) {
    $from=$seg.from;$to=$seg.to
    $sx=($from[0]-$originX)/960;$sy=($from[1]-$originY)/540
    $ex=($to[0]-$originX)/960;$ey=($to[1]-$originY)/540
    $path=('M {0} {1} L {2} {3} E' -f $sx.ToString('0.######',[cultureinfo]::InvariantCulture),$sy.ToString('0.######',[cultureinfo]::InvariantCulture),$ex.ToString('0.######',[cultureinfo]::InvariantCulture),$ey.ToString('0.######',[cultureinfo]::InvariantCulture))
    $b=$effect.Behaviors.Add(1);$b.MotionEffect.Path=$path
    if($count -eq 0){while($effect.Behaviors.Count -gt 1){$effect.Behaviors.Item(1).Delete()}}
    $b.Timing.Duration=[double]$seg.seconds;$b.Timing.TriggerDelayTime=$elapsed
    $elapsed += [double]$seg.seconds;$count++
  }
  return @{effect=$effect;duration=$elapsed;behaviors=$effect.Behaviors.Count}
}
function Route-Segments($data) {
  $segments=New-Object System.Collections.ArrayList
  $last=@(156.0,92.4)
  foreach($step in $data.route) {
    $edge=$data.edges | Where-Object id -eq $step.edge | Select-Object -First 1
    $tokens=[regex]::Matches($edge.path,'[MHV]|-?\d+(?:\.\d+)?') | ForEach-Object Value
    $x=0.0;$y=0.0;$j=0;$points=New-Object System.Collections.ArrayList
    while($j -lt $tokens.Count){
      $op=$tokens[$j];$j++
      switch($op){
        'M' {$x=[double]$tokens[$j];$y=[double]$tokens[$j+1];$j+=2}
        'H' {$x=[double]$tokens[$j];$j++}
        'V' {$y=[double]$tokens[$j];$j++}
      }
      [void]$points.Add(@(($x*0.6),($y*0.6)))
    }
    $start=$points[0];$end=$points[$points.Count-1]
    [void]$segments.Add(@{from=$last;to=$start;seconds=0.01})
    [void]$segments.Add(@{from=$start;to=$end;seconds=[double]$step.seconds})
    [void]$segments.Add(@{from=$end;to=$end;seconds=[double]$step.pause})
    $last=$end
  }
  [void]$segments.Add(@{from=$last;to=@(156.0,92.4);seconds=0.1})
  return ,$segments.ToArray()
}
$app=New-Object -ComObject PowerPoint.Application
$deck=$null
try {
  $deck=$app.Presentations.Open($source,-1,0,0)
  $deck.SaveAs($output,24)
  for($i=$deck.Slides.Count;$i -ge 1;$i--){$deck.Slides.Item($i).Delete()}
  for($i=1;$i -le 10;$i++){$null=$deck.Slides.Add($i,12)}
  $W=[double]$deck.PageSetup.SlideWidth;$H=[double]$deck.PageSetup.SlideHeight
  if([math]::Abs($W-960) -gt 1 -or [math]::Abs($H-540) -gt 1){throw "Unexpected source dimensions: $W x $H"}
  $titles=@();$effects=@();$linkCount=0
  for($i=1;$i -le 10;$i++){
    Write-Output ("Building base slide $i")
    $s=$deck.Slides.Item($i);$d=$content.slides[$i-1];$s.Name=('Visual '+$i+' '+$d.visualType)
    $null=Box $s 0 0 960 540 $C.navy
    $s.SlideShowTransition.AdvanceOnClick=-1;$s.SlideShowTransition.AdvanceOnTime=0
    $accent=switch($i){3{$C.amber}4{$C.cyan}5{$C.violet}6{$C.blue}7{$C.cyan}8{$C.blue}9{$C.amber}10{$C.green}default{$C.cyan}}
    if($i -notin 1,2){Header $s $d $i $accent}
    Nav $s $i $deck
    Notes $s ($d.notes+' Current status: one synthetic web intake POST returned HTTP 200/analyzed with 10 observations and 5 suggestions in 21.943 seconds after one rejected grounding result and repair. This is a functional check, not a reliability benchmark. The CLI READ runtime completed four live calls with synthetic providers and WRITE fixtures. New web intake is not connected to an accepted live research dossier, so planning remains blocked. Motion illustrates the proposed workflow, not live telemetry. Human approval is an authenticated application action, not an automatic animation event.')
    $titles+=@{slide=$i;title=$d.title}
  }
  # 1: opening composition with an oversized manuscript and flowing role markers.
  Write-Output 'Building visual slide 1'
  $s=$deck.Slides.Item(1)
  $null=Text $s 'STORY BUILDER / V3' 47 44 450 24 12 $C.cyan $true
  $null=Text $s 'One story.' 45 96 560 70 49 $C.cream $true
  $null=Text $s 'Many specialists.' 45 164 650 70 49 $C.cream $true
  $null=Text $s 'One writer in control.' 47 243 580 50 28 $C.amber $true
  $null=Text $s 'A proposed path from first idea to an accepted, ordered manuscript.' 49 318 570 60 17 $C.muted
  $null=Box $s 694 78 178 302 $C.cream 0.06
  foreach($n in 0..5){$null=Rule $s 720 (131+$n*33) 842 (131+$n*33) $C.panel2 4}
  $null=Box $s 677 65 178 302 $C.panel2 0.06
  $null=Text $s '12' 711 95 120 96 67 $C.cyan $true 2
  $null=Text $s 'agent instances' 697 196 140 32 17 $C.cream $true 2
  $null=Text $s 'one shared coordinator' 690 251 154 46 12 $C.muted $false 2
  $null=Circle $s 696 385 8 $C.amber
  $null=Rule $s 705 385 842 385 $C.cyan 3
  $null=Circle $s 852 385 8 $C.green
  $q=Text $s 'EXPLORE THE SYSTEM MAP  →' 48 437 370 27 15 $C.cyan $true;Link $q $deck.Slides.Item(2)
  # 2: canonical SVG diagram, sized exactly to its 1600 x 900 coordinate system.
  Write-Output 'Building visual slide 2'
  $s=$deck.Slides.Item(2)
  $pic=$s.Shapes.AddPicture($diagram,0,-1,0,0,960,540);$pic.Name='Canonical architecture v3 SVG'
  $q=Text $s '← PREVIOUS' 785 61 92 20 10 $C.muted;Link $q $deck.Slides.Item(1)
  $q=Text $s 'NEXT →' 880 61 72 20 10 $C.cyan $true;Link $q $deck.Slides.Item(3)
  foreach($n in $diagramData.nodes){
    $hit=Box $s ([double]$n.x*0.6) ([double]$n.y*0.6) ([double]$n.w*0.6) ([double]$n.h*0.6) $C.navy
    $hit.Fill.Transparency=1;$hit.Name=('Jump '+$n.id);Link $hit $deck.Slides.Item([int]$n.slide);$linkCount++
  }
  $dot=Circle $s 156 92.4 6 $C.cream;$dot.Name='Animated workflow light'
  $motion=Add-Motion $s $dot (Route-Segments $diagramData) 156 92.4
  if($motion.duration -lt 45 -or $motion.duration -gt 60){throw ('Map motion must be 45–60 seconds; actual='+$motion.duration)}
  $effects+=@{slide=2;duration=$motion.duration;behaviors=$motion.behaviors}
  # 3: writer input and eighteen optional detail decisions.
  $s=$deck.Slides.Item(3)
  Card $s 'START' 'Your idea' 'Premise + genre' 42 198 240 230 $C.amber
  $null=Rule $s 294 309 345 309 $C.amber 3
  Card $s '18 DETAIL CHIPS' 'Choose each one' 'Accept, customize, reject, or defer' 348 198 280 230 $C.violet
  for($row=0;$row -lt 3;$row++){for($col=0;$col -lt 6;$col++){$null=Box $s (373+$col*39) (357+$row*15) 27 8 $(if(($row+$col)%3 -eq 0){$C.amber}else{$C.violet}) 0.2}}
  $null=Rule $s 639 309 690 309 $C.amber 3
  Card $s 'HUMAN GATE' 'Confirm brief' 'Only chosen details become constraints' 695 198 222 230 $C.amber
  # 4: two source feeds become a single gated dossier.
  $s=$deck.Slides.Item(4)
  Card $s 'SOURCE 01' 'NYT Books' 'Outcome + metadata' 43 197 250 130 $C.cyan
  Card $s 'SOURCE 02' 'Gutendex' 'Outcome + permitted text' 43 341 250 130 $C.cyan
  $null=Rule $s 300 290 366 290 $C.cyan 3;$null=Rule $s 300 407 366 332 $C.cyan 3
  Card $s 'VERSIONED' 'Research dossier' 'Source · confidence · missing evidence' 370 217 300 220 $C.cyan
  $null=Rule $s 680 325 725 325 $C.amber 3
  Card $s 'WRITER' 'Accept exact version' 'Required evidence opens planning' 728 217 190 220 $C.amber
  # 5: planning fan and explicit version approval.
  $s=$deck.Slides.Item(5)
  foreach($j in 0..2){Card $s ('BIBLE '+@('A','B','C')[$j]) ('Plan '+@('A','B','C')[$j]) 'Facts + 3 beats' (45+$j*216) 215 190 185 $C.violet}
  $null=Rule $s 676 306 724 306 $C.violet 3
  Card $s 'HUMAN GATE' 'One exact version' 'Resolve conflicts and approve beats' 729 215 190 185 $C.amber
  $null=Text $s 'Stable canonical facts carry into every chapter.' 48 436 760 30 15 $C.muted
  # 6: parallel chapter cards and a shared barrier.
  $s=$deck.Slides.Item(6)
  $null=Pill $s 'APPROVED BIBLE vN' 44 183 223 $C.amber 14
  $null=Rule $s 270 202 338 202 $C.blue 3
  foreach($j in 0..2){
    Card $s ('INDEX '+($j+1)) ('Chapter '+($j+1)) 'Same bible version' (342+$j*195) 208 177 175 $C.blue
    $null=Rule $s (430+$j*195) 383 430 427 $C.blue 2
  }
  $null=Box $s 321 431 220 38 $C.panel2 0.2
  $null=Text $s 'BARRIER  1 + 2 + 3' 338 441 184 25 15 $C.cream $true 2
  # 7: Reader handoff schema and bounded repair turn.
  $s=$deck.Slides.Item(7)
  $fields=@('task','userInstructions','sourceReferences','completeness','version')
  for($j=0;$j -lt 5;$j++){$null=Pill $s $fields[$j] 47 (191+$j*51) 385 $C.cyan 15}
  $null=Rule $s 451 303 530 303 $C.cyan 3
  Card $s 'EDITOR VALIDATION' 'Two receivers' 'Each validates before editing' 536 202 370 170 $C.blue
  $null=Pill $s 'One bounded Reader repair' 536 395 370 $C.amber 14
  # 8: proposals and independent exact-version checks.
  $s=$deck.Slides.Item(8)
  Card $s 'CRITIC / EDITOR A' 'Proposal A' 'Exact ID · version · hash' 42 211 294 208 $C.blue
  Card $s 'CRITIC / EDITOR B' 'Proposal B' 'Exact ID · version · hash' 354 211 294 208 $C.blue
  $null=Rule $s 660 289 696 289 $C.cyan 3
  Card $s 'ONE INSTANCE' 'Consistency' 'Check A, then B. Reports stay separate.' 702 211 215 208 $C.cyan
  # 9: focused native loop plus looping light.
  $s=$deck.Slides.Item(9)
  Card $s 'CURRENT VERSION' 'Writer review' 'Accept · finish · revise' 65 212 250 190 $C.amber
  Card $s 'ROUND ≤ 2' 'Reader' 'Refresh the handoff' 357 212 250 190 $C.cyan
  Card $s 'EXACT VERSIONS' 'Editors + checks' 'New proposals, new checks' 650 212 250 190 $C.blue
  $null=Rule $s 317 306 354 306 $C.amber 3
  $null=Rule $s 609 306 647 306 $C.cyan 3
  $null=Rule $s 775 420 775 454 $C.blue 3
  $null=Rule $s 775 454 190 454 $C.amber 3
  $null=Rule $s 190 454 190 421 $C.amber 3
  $null=Text $s 'Revision returns here' 387 457 220 22 13 $C.amber $true 2
  $dot=Circle $s 315 306 6 $C.cream;$dot.Name='Animated bounded revision light'
  $parts=@(
    @{from=@(315,306);to=@(357,306);seconds=2.0},
    @{from=@(357,306);to=@(607,306);seconds=2.8},
    @{from=@(607,306);to=@(650,306);seconds=2.0},
    @{from=@(650,306);to=@(775,306);seconds=2.6},
    @{from=@(775,306);to=@(775,454);seconds=2.4},
    @{from=@(775,454);to=@(190,454);seconds=5.0},
    @{from=@(190,454);to=@(190,306);seconds=2.4},
    @{from=@(190,306);to=@(315,306);seconds=2.0},
    @{from=@(315,306);to=@(315,306);seconds=2.5}
  )
  $motion=Add-Motion $s $dot $parts 315 306
  $effects+=@{slide=9;duration=$motion.duration;behaviors=$motion.behaviors}
  $q=Text $s 'RETURN TO READER  →' 48 468 240 20 12 $C.cyan $true;Link $q $deck.Slides.Item(7)
  # 10: export object and status legend, with replay action.
  $s=$deck.Slides.Item(10)
  $null=Box $s 60 190 325 244 $C.cream 0.06
  $null=Text $s 'MANUSCRIPT.md' 83 211 270 35 18 $C.navy $true
  foreach($n in 0..4){$null=Rule $s 84 (273+$n*27) 350 (273+$n*27) $C.muted 3}
  $null=Circle $s 448 313 22 $C.green
  $null=Text $s '✓' 434 294 30 32 25 $C.navy $true 2
  $null=Text $s 'Accepted version' 492 217 365 44 25 $C.cream $true
  $null=Text $s "Ordered chapters`nApproved bible + evidence`nUnresolved issues labeled" 494 279 365 115 18 $C.muted
  $q=Text $s 'REPLAY THE SYSTEM MAP  →' 493 423 360 30 16 $C.cyan $true;Link $q $deck.Slides.Item(2)
  # Verify native editability, internal links, shape text geometry, and render all ten slides.
  $overflow=@();$links=@();$counts=@()
  foreach($slide in $deck.Slides){
    $editable=0
    foreach($shape in $slide.Shapes){
      if($shape.HasTextFrame -and $shape.TextFrame.HasText){
        $editable++
        if($shape.TextFrame.TextRange.BoundHeight -gt ($shape.Height+2)){$overflow+=@{slide=$slide.SlideIndex;shape=$shape.Name;text=$shape.TextFrame.TextRange.Text;bound=$shape.TextFrame.TextRange.BoundHeight;height=$shape.Height}}
      }
      $a=$shape.ActionSettings.Item(1)
      if($a.Action -eq 7){$links+=@{slide=$slide.SlideIndex;shape=$shape.Name;target=$a.Hyperlink.SubAddress}}
    }
    $counts+=@{slide=$slide.SlideIndex;editableTextShapes=$editable;allShapes=$slide.Shapes.Count}
    $slide.Export((Join-Path $qa ('slide-{0:00}.png' -f $slide.SlideIndex)),'PNG',1280,720)
  }
  if($deck.Slides.Count -ne 10){throw 'Expected ten slides.'}
  if($overflow.Count -gt 0){throw ('Text overflow in '+$overflow.Count+' shapes: '+($overflow|ConvertTo-Json -Compress))}
  $deck.Save()
  $deck.SaveAs($show,28)
  $verification=@{sourceSha256=$sourceHash;sourceUnchanged=((Get-FileHash $source -Algorithm SHA256).Hash -eq $sourceHash);slides=$deck.Slides.Count;titles=$titles;motion=$effects;links=$links;shapeCounts=$counts;overflow=$overflow;illustrationOnly=$true}
  $verification|ConvertTo-Json -Depth 8|Set-Content (Join-Path $qa 'verification.json') -Encoding UTF8
  Write-Output ('Visual deck: '+$output)
  Write-Output ('Slide show: '+$show)
  Write-Output ('Slides: '+$deck.Slides.Count+'; links: '+$links.Count+'; motion effects: '+$effects.Count+'; overflow: '+$overflow.Count)
} finally {
  if($deck){$deck.Close()}
  if($app.Presentations.Count -eq 0){$app.Quit()}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
