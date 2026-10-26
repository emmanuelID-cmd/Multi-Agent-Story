param([string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent))
$ErrorActionPreference = 'Stop'
$template = 'C:\Users\dejes\.codex\plugins\cache\openai-curated-remote\openai-templates\0.1.1\skills\artifact-template-team-alignment\assets\reference.pptx'
$build = Join-Path $ProjectRoot '.tools\team-alignment-build'
$out = Join-Path $ProjectRoot 'docs\artifacts'
$pptx = Join-Path $out 'read-agent-team-alignment.pptx'
$ppsx = Join-Path $out 'read-agent-team-alignment.ppsx'
if ((Test-Path $pptx) -or (Test-Path $ppsx)) { throw 'Output exists. Choose a new filename before rebuilding.' }
$originalHash = (Get-FileHash $template -Algorithm SHA256).Hash
New-Item -ItemType Directory -Path $build -Force | Out-Null
New-Item -ItemType Directory -Path $out -Force | Out-Null
$maps = @{
  1 = @{4="READ agents`r& handoffs";5="Manny READ / Justin WRITE`rPRD v3 / verified run"}
  2 = @{3='The interactive handoff map'}
  7 = @{533='Writer input before research';534="Save now. Confirm choices.";12="Genre and a confirmed research scope start the search.`r`rThe helper shows characters, setting, lore, time period, audience, tone, plot direction, rising action, stakes, climax, and falling action.`r`rReview independent gaps together. Choose an option, write your own, or defer. Dependent questions wait.";2='Keep the original input';16='Separate gaps from blockers';18='Accept each suggestion explicitly';20='Confirm the resulting scope';23='Research begins after confirmation'}
  8 = @{533='Research handoff';14="Confirmed brief and scope`rThe Research agent calls the allowed book-metadata tool, reads eligible text, and returns a versioned dossier candidate.";3="Evidence to carry forward`rBoth provider outcomes, source identity, dates, rights, and located observations.";4="Genre and required period / setting coverage`rExact source quotes and hashes`rNonblocking limitations stay visible";11="The planning gate`rAll required dimensions need traceable support. The model cannot accept its own dossier.";13="Missing evidence keeps planning blocked`rA scope change needs explicit confirmation`rA provider outage is never a silent bypass";26='The live smoke run used controlled book-provider fixtures and original test text, not live book research.'}
  14 = @{11='Planning and the chapter barrier';9='Accepted research';13='Exact bible approval';14='Three valid chapters';16="Planning`rUse accepted research for Bible proposals.";17="Human approval`rApprove an exact bible version. This creates the immutable writing input.";18="Chapter barrier`rValidate chapters 1, 2, 3 against that version before Reader starts."}
  15 = @{11='Reader handoff to both Editors';16='Read assigned sources';17='Validate the handoff';18='Receive and acknowledge';21="Reader's task`rPrepare source-grounded analysis. Return neutral observations as well as located contradictions. Do not produce the Editors' manuscripts.";23="Five required fields`rTask, recorded user instructions, source references, completeness and confidence, and versions. Bind hashes to actual chapters.";25="Editor boundary`rValidate the source versions and recorded task before editing. A rejected handoff returns for one bounded repair, then clarification or failure."}
  13 = @{533='Two independent editorial proposals';3="Justin WRITE`rThe existing A and B functions return separate manuscript proposals. In the verified harness, these are synthetic connectors, not live WRITE models.";15='Editor A';12='Continuity and pacing proposal against the accepted snapshot.';17='Editor B';16='Voice and atmosphere proposal against the same snapshot.';19='Separate versions';18='Keep alternatives distinct. Record each exact manuscript digest.';21='No direct acceptance';20='Neither Editor can approve canon or bypass the writer decision.'}
  10 = @{533='Consistency checks each exact version';6="Manny READ`rConsistency runs independently on each edited manuscript, against the approved facts and the full three-chapter snapshot.";10="Assigned proposal`rCheck proposal ID, version, and content digest before dispatch.";8="Located findings`rCite the chapter passage, controlling fact, severity, and possible correction.";5="Missing evidence`rReturn partial or unavailable. An absent check never means no issues.";3="A later edit`rThe old report remains attached to the old version. Check the new version again."}
  11 = @{3='Human review and the revision loop';10="Review candidates`rInspect the ordered manuscript, located findings, evidence, and unresolved issues. Agent output is a proposal.";11="Accept or reject`rAn authenticated writer accepts an exact current version. The local harness does not exercise product acceptance.";4="Request a revision`rReturn to Reader and Editors. Keep the approved version. Two rounds maximum.";5="Recheck and stop`rCheck the new version. Cancel or budget exhaustion preserves partial work."}
  19 = @{8='Failure and recovery routes';14='A failed check stops its dependent handoff. Click a route below to return to the responsible stage.';9="Evidence gap`rA required source is unavailable.`rReturn to Research.";10="Rejected handoff`rA source or version is invalid.`rReturn to Reader. Repair once.";11="Stale or canceled`rPreserve completed work.`rRecheck the current version."}
  4 = @{533="Three READ agents.`rFour live Claude calls.`r95 of 95 tests passed.";4="Verified run`rFour live READ calls: Research, Reader, and two Consistency checks.";7="One scenario passed`rProviders and WRITE were fixtures. Reliability remains unmeasured."}
  23 = @{557='Ownership, tools, and shared state';558="Manny READ`rRead-only analysis. Fixed tools. Validate sources, versions, and output before handoff.";559="Justin WRITE`rMinimal connectors only. Keep peer prompts, design, behavior, and tests unchanged.";560="Shared coordinator`rImmutable local snapshots and saved reports. Production acceptance and SQL remain separate."}
  24 = @{4="Trace the loop";5="Click the map to replay.`rSlide Show activates links."}
}
$keep = @(1,2,7,8,14,15,13,10,11,19,4,23,24)
$names = @('READ agents and handoffs','Interactive handoff map','Writer input','Research dossier','Planning and drafting','Reader handoff','Editor alternatives','Exact-version Consistency','Human revision loop','Failure routes','Verified execution','Ownership and tools','Replay and run guide')
function Leaves($collection) {
  foreach($shape in $collection) {
    if ([int]$shape.Type -eq 6) { Leaves $shape.GroupItems }
    elseif ($shape.HasTable) {
      for($r=1;$r -le $shape.Table.Rows.Count;$r++) {
        for($c=1;$c -le $shape.Table.Columns.Count;$c++) { Write-Output -NoEnumerate $shape.Table.Cell($r,$c).Shape }
      }
    }
    else { Write-Output -NoEnumerate $shape }
  }
}
function Set-ShapeText($shape,[string]$value) {
  $font=$shape.TextFrame.TextRange.Font.Name
  $size=$shape.TextFrame.TextRange.Font.Size
  $shape.TextFrame.TextRange.Text=$value
  if($font){$shape.TextFrame.TextRange.Font.Name=$font}
  if($size -gt 0){$shape.TextFrame.TextRange.Font.Size=$size}
  if($shape.Height -lt 25){$shape.TextFrame.MarginTop=0;$shape.TextFrame.MarginBottom=0}
  if($shape.Height -lt 18){$shape.Height=24}
}
function Click-Action($shape) {
  if($null -ne $shape.ActionSettings){return $shape.ActionSettings.Item(1)}
  if($shape.HasTextFrame){return $shape.TextFrame.TextRange.ActionSettings.Item(1)}
  return $null
}
function Link-Shape($shape,$target) {
  $action=Click-Action $shape
  if($null -eq $action){throw ('No action target on '+$shape.Name)}
  $action.Action=7
  $action.Hyperlink.Address=''
  $action.Hyperlink.SubAddress=('{0},{1},{2}' -f $target.SlideID,$target.SlideIndex,$target.Name)
}
function Link-Text($slide,[string]$text,[double]$left,[double]$top,[double]$width,$target) {
  $shape=$slide.Shapes.AddTextbox(1,$left,$top,$width,24)
  $shape.Name='Navigation '+$text
  $shape.TextFrame.TextRange.Text=$text
  $shape.TextFrame.TextRange.Font.Name='Inter'
  $shape.TextFrame.TextRange.Font.Size=12
  $shape.TextFrame.TextRange.Font.Color.RGB=0x945B2D
  $shape.TextFrame.TextRange.Font.Underline=-1
  $shape.TextFrame.MarginLeft=0
  $shape.TextFrame.MarginRight=0
  Link-Shape $shape $target
}
$app=New-Object -ComObject PowerPoint.Application
$deck=$null
try {
  $deck=$app.Presentations.Open($template,-1,0,0)
  $deck.SaveAs($pptx,24)
  # Retain and reorder original slides instead of replacing their visual system.
  $originalSlides=@{}
  for($i=1;$i -le $deck.Slides.Count;$i++){$originalSlides[$i]=$deck.Slides.Item($i).SlideID}
  for($i=$deck.Slides.Count;$i -ge 1;$i--){if($i -notin $keep){$deck.Slides.Item($i).Delete()}}
  for($i=0;$i -lt $keep.Count;$i++){$deck.Slides.FindBySlideID($originalSlides[$keep[$i]]).MoveTo($i+1)}
  for($i=0;$i -lt $keep.Count;$i++) {
    $source=$keep[$i];$slide=$deck.Slides.Item($i+1);$slide.Name=$names[$i]
    foreach($shape in @(Leaves $slide.Shapes)) {
      if($shape.HasTextFrame -and $shape.TextFrame.HasText){
        if($maps[$source].ContainsKey([int]$shape.Id)){Set-ShapeText $shape $maps[$source][[int]$shape.Id]}
        elseif($shape.TextFrame.TextRange.Text.Trim() -eq [string]$source){Set-ShapeText $shape ([string]($i+1))}
      }
    }
    try {$slide.NotesPage.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text="Sources: docs/prd/drafts/PRD-v3-draft.md, especially sections 3 and 5-6. Runtime evidence: .tools/agent-runs/14b1dda7-4edc-45e1-a641-38db38a2e0f5/report.json. READ model: claude-haiku-5-5. NYT/Gutendex and WRITE connectors: fixtures. The web workspace is still fixture-backed."}catch{}
    $slide.SlideShowTransition.AdvanceOnTime=0
    $slide.SlideShowTransition.AdvanceOnClick=-1
  }
  $agenda=$deck.Slides.Item(2)
  $items=@(Leaves $agenda.Shapes)|Where-Object {$_.HasTextFrame -and $_.TextFrame.HasText -and $_.TextFrame.TextRange.Text -match 'Agenda item'}|Sort-Object Top
  $labels=@('Writer input and Research','Planning and the chapter barrier','Reader and both Editors','Consistency and human review','Failure and recovery routes','Verified run and team boundaries')
  $targets=@(3,5,6,8,10,11)
  if($items.Count -ne 6){throw 'Expected six template agenda items.'}
  for($i=0;$i -lt 6;$i++){Set-ShapeText $items[$i] $labels[$i]; Link-Shape $items[$i] $deck.Slides.Item($targets[$i])}
  for($i=1;$i -le $deck.Slides.Count;$i++) {
    $slide=$deck.Slides.Item($i)
    if($i -gt 1){Link-Text $slide 'Previous' 31 493 74 $deck.Slides.Item($i-1)}
    Link-Text $slide 'Handoff map' 120 493 100 $deck.Slides.Item(2)
    if($i -lt $deck.Slides.Count){Link-Text $slide 'Next handoff' 235 493 105 $deck.Slides.Item($i+1)}
    if($i -in 3,4,5,6,7,8,9){Link-Text $slide 'If a check fails' 355 493 120 $deck.Slides.Item(10)}
  }
  # Explicit loop edges and recovery routes remain native, editable slide actions.
  Link-Text $deck.Slides.Item(9) 'Request revision: return to Reader' 493 454 330 $deck.Slides.Item(6)
  Link-Text $deck.Slides.Item(8) 'New edit: recheck this version' 493 454 330 $deck.Slides.Item(8)
  foreach($spec in @(@(9,4),@(10,6),@(11,8))) {
    $shape=@(Leaves $deck.Slides.Item(10).Shapes)|Where-Object {$_.Id -eq $spec[0]}
    Link-Shape $shape $deck.Slides.Item($spec[1])
  }
  $warnings=@();$links=@();$texts=@()
  foreach($slide in $deck.Slides){
    foreach($shape in @(Leaves $slide.Shapes)) {
      if($shape.HasTextFrame -and $shape.TextFrame.HasText){
        $text=$shape.TextFrame.TextRange.Text
        if($text -match 'Lorem ipsum|Title here|Title goes here|Agenda item|Date$|Thank you|Speaker Full Name'){throw ('Unfilled template text on slide '+$slide.SlideIndex+': '+$text)}
        if($shape.TextFrame.TextRange.BoundHeight -gt ($shape.Height+2)){$warnings+=@{slide=$slide.SlideIndex;shape=$shape.Name;bound=$shape.TextFrame.TextRange.BoundHeight;height=$shape.Height}}
        $texts+=@{slide=$slide.SlideIndex;shape=$shape.Name;text=$text}
      }
      $click=Click-Action $shape
      if($click -and $click.Action -eq 7){$links+=@{slide=$slide.SlideIndex;shape=$shape.Name;target=$click.Hyperlink.SubAddress}}
    }
    $slide.Export((Join-Path $build ('final-{0:00}.png' -f $slide.SlideIndex)),'PNG',1280,720)
  }
  $deck.Save()
  $deck.SaveAs($ppsx,28)
  @{slides=$deck.Slides.Count;links=$links;overflowWarnings=$warnings;texts=$texts;sourceHash=$originalHash;sourceUnchanged=((Get-FileHash $template -Algorithm SHA256).Hash -eq $originalHash)}|ConvertTo-Json -Depth 7|Set-Content (Join-Path $build 'verification.json') -Encoding UTF8
  Write-Output ('Slides: '+$deck.Slides.Count+'; internal links: '+$links.Count+'; overflow warnings: '+$warnings.Count)
  $warnings|ConvertTo-Json -Depth 3
  Write-Output $pptx
  Write-Output $ppsx
} finally {
  if($deck){$deck.Close()}
  if($app.Presentations.Count -eq 0){$app.Quit()}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
