/**
 * Generate real-FORMAT Path of Building export codes for tests.
 *
 *   node scripts/make-pob-fixtures.mjs
 *
 * Writes test/fixtures/pob-<name>.txt — each a base64url(zlib(XML)) code, i.e. the
 * exact export pipeline PoB uses, so the decode+parse path is exercised on genuine
 * export-format data. (We couldn't reliably fetch a live third-party export in this
 * environment; these are hand-authored to PoB's documented schema, not lifted source.)
 */
import zlib from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('../test/fixtures/', import.meta.url))
mkdirSync(dir, { recursive: true })

const encode = xml => zlib.deflateSync(Buffer.from(xml.trim(), 'utf8')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_')
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

// ── Leveling: level 42 Witch, no ascendancy ──────────────────────────────────
const levelingNodes = [...range(2, 26)].join(',') // 25 simple nodes
const leveling = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="42" targetVersion="3_0" className="Witch" ascendClassName="None" mainSocketGroup="1">
    <PlayerStat stat="Life" value="1240"/>
    <PlayerStat stat="EnergyShield" value="60"/>
    <PlayerStat stat="FireResist" value="-12"/>
    <PlayerStat stat="ColdResist" value="20"/>
    <PlayerStat stat="LightningResist" value="14"/>
    <PlayerStat stat="ChaosResist" value="-30"/>
    <PlayerStat stat="TotalDPS" value="8500"/>
  </Build>
  <Skills activeSkillSet="1">
    <SkillSet id="1">
      <Skill slot="Weapon 1" mainActiveSkill="1" enabled="true">
        <Gem nameSpec="Freezing Pulse" skillId="FreezingPulse" level="8" quality="0" enabled="true"/>
        <Gem nameSpec="Added Cold Damage Support" skillId="SupportAddedColdDamage" level="8" quality="0" enabled="true"/>
      </Skill>
      <Skill slot="Boots" enabled="true">
        <Gem nameSpec="Flame Dash" skillId="FlameDash" level="6" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Tree activeSpec="1">
    <Spec title="Leveling" treeVersion="3_28" nodes="${levelingNodes}">
      <URL>https://www.pathofexile.com/passive-skill-tree/AAAA</URL>
    </Spec>
  </Tree>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: MAGIC
Reaver Sword of the Apprentice
--------
Item Level: 40
--------
Adds 5 to 9 Cold Damage
+18 to maximum Mana
</Item>
    <Item id="2">
Rarity: MAGIC
Reflecting Wool Shoes of the Wind
--------
Item Level: 12
--------
+20 to maximum Energy Shield
20% increased Movement Speed
</Item>
    <ItemSet id="1">
      <Slot name="Weapon 1" itemId="1"/>
      <Slot name="Boots" itemId="2"/>
    </ItemSet>
  </Items>
</PathOfBuilding>`

// ── Endgame: level 95 Witch Necromancer; node ids 100/200/300 exist in the tree fixture ──
const endgameNodes = [...range(2, 6), 100, 200, 300, ...range(400, 500)].join(',')
const endgame = `<?xml version="1.0" encoding="UTF-8"?>
<PathOfBuilding>
  <Build level="95" targetVersion="3_0" className="Witch" ascendClassName="Necromancer" mainSocketGroup="1">
    <PlayerStat stat="Life" value="5200"/>
    <PlayerStat stat="EnergyShield" value="1480"/>
    <PlayerStat stat="FireResist" value="75"/>
    <PlayerStat stat="ColdResist" value="76"/>
    <PlayerStat stat="LightningResist" value="75"/>
    <PlayerStat stat="ChaosResist" value="24"/>
    <PlayerStat stat="TotalDPS" value="3550000"/>
    <PlayerStat stat="TotalEHP" value="61000"/>
  </Build>
  <Skills activeSkillSet="1">
    <SkillSet id="1">
      <Skill slot="Body Armour" mainActiveSkill="1" enabled="true">
        <Gem nameSpec="Raise Spectre" skillId="RaiseSpectre" level="21" quality="20" enabled="true"/>
        <Gem nameSpec="Minion Damage Support" skillId="SupportMinionDamage" level="20" quality="20" enabled="true"/>
        <Gem nameSpec="Spell Echo Support" skillId="SupportSpellEcho" level="20" quality="20" enabled="true"/>
        <Gem nameSpec="Elemental Army Support" skillId="SupportElementalArmy" level="20" quality="0" enabled="true"/>
      </Skill>
      <Skill slot="Helmet" enabled="true">
        <Gem nameSpec="Hatred" skillId="Hatred" level="20" quality="0" enabled="true"/>
        <Gem nameSpec="Generosity Support" skillId="SupportGenerosity" level="20" quality="0" enabled="true"/>
      </Skill>
    </SkillSet>
  </Skills>
  <Tree activeSpec="1">
    <Spec title="Endgame" treeVersion="3_28" nodes="${endgameNodes}">
      <URL>https://www.pathofexile.com/passive-skill-tree/BBBB</URL>
    </Spec>
  </Tree>
  <Items activeItemSet="1">
    <Item id="1">
Rarity: UNIQUE
Belly of the Beast
Full Wyrmscale
--------
Item Level: 86
--------
+40 to maximum Life
20% increased maximum Life
+15% to all Elemental Resistances
</Item>
    <Item id="2">
Rarity: UNIQUE
Headhunter
Leather Belt
--------
Item Level: 84
--------
+40 to maximum Life
+50 to Strength
</Item>
    <Item id="3">
Rarity: RARE
Doom Lace
Opal Ring
--------
Item Level: 84
--------
+85 to maximum Life
+38% to Fire Resistance
+40% to Lightning Resistance
</Item>
    <ItemSet id="1">
      <Slot name="Body Armour" itemId="1"/>
      <Slot name="Belt" itemId="2"/>
      <Slot name="Ring 1" itemId="3"/>
    </ItemSet>
  </Items>
</PathOfBuilding>`

for (const [name, xml] of [['leveling', leveling], ['endgame', endgame]]) {
  const code = encode(xml)
  writeFileSync(`${dir}pob-${name}.txt`, code)
  console.log(`wrote pob-${name}.txt (${code.length} chars)`)
}
