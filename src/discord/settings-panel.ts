import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { findModel, listModels, type ModelOption } from '../engines/catalog.ts';
import { ENGINE_LABEL, ENGINES, type AgentSettings, type Engine } from '../engines/types.ts';
import { clip } from './chunk.ts';

/** Which control a command leads with. Every panel can change all three. */
export type Focus = 'model' | 'effort' | 'engine';
/** A task's thread id, or `d` for the defaults new tasks start with. */
export type Scope = string;
export type PanelContext = { scope: Scope; focus: Focus; settings: AgentSettings; taskTitle?: string; busyOn?: Engine; lastEngine?: Engine };

type Row = ActionRowBuilder<MessageActionRowComponentBuilder>;
const COLOR: Record<Engine, number> = { claude: 0xd97757, codex: 0x10a37f };
const TITLE: Record<Focus, string> = { model: 'Model', effort: 'Effort', engine: 'Engine' };

export async function renderPanel(ctx: PanelContext) {
  const { settings: s, focus } = ctx;
  const engine = s.engine;
  const models = await listModels(engine);
  const model = findModel(models, s[engine].model);
  const id = (kind: string, value = ''): string => `cfg:${ctx.scope}:${focus}:${kind}${value ? `:${value}` : ''}`;

  const engines = row(...ENGINES.map((e) => new ButtonBuilder().setCustomId(id('eng', e))
    .setLabel(e === engine ? `✓ ${ENGINE_LABEL[e]}` : ENGINE_LABEL[e])
    .setStyle(e === engine ? ButtonStyle.Primary : ButtonStyle.Secondary)));
  const modelMenu = row(modelSelect(id('mod'), engine, models, s[engine].model));
  const effortMenu = model?.efforts.length ? [row(effortSelect(id('effsel'), model, s[engine].effort))] : [];
  const effortButtons = effortRows(id, model, s[engine].effort);

  const components: Row[] = focus === 'model' ? [modelMenu, engines, ...effortButtons]
    : focus === 'effort' ? [...(effortMenu.length ? effortMenu : effortButtons), engines, modelMenu]
    : [engines, modelMenu, ...effortButtons];

  const scopeName = ctx.scope === 'd' ? 'defaults for new tasks' : `this task${ctx.taskTitle ? ` — ${clip(ctx.taskTitle, 60)}` : ''}`;
  const embed = new EmbedBuilder().setColor(COLOR[engine]).setTitle(`⚙️ ${TITLE[focus]} · ${scopeName}`)
    .addFields(
      { name: 'Engine', value: ENGINE_LABEL[engine], inline: true },
      { name: 'Model', value: model ? `${model.label}\n\`${model.value}\`` : `\`${s[engine].model}\``, inline: true },
      { name: 'Effort', value: s[engine].effort ?? '—', inline: true },
    )
    .setDescription(notes(ctx, model).join('\n'));
  return { embeds: [embed], components };
}

function notes(ctx: PanelContext, model: ModelOption | undefined): string[] {
  const out = model?.description ? [`*${model.description}*`, ''] : [];
  if (ctx.scope === 'd') {
    out.push('New tasks start with these. Run the command inside a task\'s thread to change only that task.');
    return out;
  }
  out.push('Applies from the next message in this thread.');
  if (ctx.lastEngine && ctx.lastEngine !== ctx.settings.engine) {
    out.push(`Switching engine hands the thread history to ${ENGINE_LABEL[ctx.settings.engine]}.`);
  }
  if (ctx.busyOn) out.push(`A turn is running on ${ENGINE_LABEL[ctx.busyOn]} right now; changes apply when it ends.`);
  return out;
}

function modelSelect(customId: string, engine: Engine, models: ModelOption[], current: string): StringSelectMenuBuilder {
  const list = models.slice(0, 25);
  if (!list.some((m) => m.value === current)) list.unshift({ value: current, label: current, description: 'current setting', efforts: [] });
  return new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(`Choose a ${ENGINE_LABEL[engine]} model`)
    .addOptions(list.slice(0, 25).map((m) => ({
      label: clip(m.label, 100),
      value: m.value,
      description: clip(m.value === m.label ? m.description : `${m.value} — ${m.description}`, 100) || undefined,
      default: m.value === current,
    })));
}

function effortSelect(customId: string, model: ModelOption, current: string | undefined): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder('Choose an effort level')
    .addOptions(model.efforts.slice(0, 25).map((e) => ({
      label: e.value,
      value: e.value,
      description: clip(e.description, 100) || undefined,
      default: e.value === current,
    })));
}

/** Effort as buttons: one row up to five levels, otherwise two even rows. */
function effortRows(id: (kind: string, value?: string) => string, model: ModelOption | undefined, current: string | undefined): Row[] {
  const levels = model?.efforts ?? [];
  if (!levels.length) {
    return [row(new ButtonBuilder().setCustomId(id('eff', 'none')).setLabel('No effort levels for this model').setStyle(ButtonStyle.Secondary).setDisabled(true))];
  }
  const buttons = levels.slice(0, 10).map((e) => new ButtonBuilder().setCustomId(id('eff', e.value))
    .setLabel(e.value === current ? `✓ ${e.value}` : e.value)
    .setStyle(e.value === current ? ButtonStyle.Primary : ButtonStyle.Secondary));
  if (buttons.length <= 5) return [row(...buttons)];
  const half = Math.ceil(buttons.length / 2);
  return [row(...buttons.slice(0, half)), row(...buttons.slice(half))];
}

const row = (...items: MessageActionRowComponentBuilder[]): Row => new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(items);
