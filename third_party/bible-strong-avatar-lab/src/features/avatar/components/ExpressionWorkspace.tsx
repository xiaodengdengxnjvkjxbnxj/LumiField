import { ArrowLeft, Copy, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useState, type RefObject } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useStudioLanguage } from '@/i18n'

import { ControlSection } from '@/app/components/common'
import { AmbientMotionField, ColorField, LinkButton, NumericField } from '@/app/components/controls'
import { emptyBodyNodes, getPreviewGeometry, resolveColors, type Side } from '@/app/studio-utils'
import {
  type AvatarColors,
  type AvatarEyeDefaults,
  type AvatarRenderStyle,
} from '@/features/avatar/avatars'
import { type BodyNode } from '@/features/avatar/body'
import { scaleEye, updateEyeDimension } from '@/features/avatar/expressionEditing'
import { type Expression } from '@/features/avatar/geometry'
import { defaultExpression } from '@/features/avatar/presets'
import { type SurfaceConfig } from '@/features/avatar/surfaces'
import { StaticPixelAvatarCanvas } from '@/features/rendering/components/PixelAvatarCanvas'
export function SurfaceThumbnail({ surface }: { surface: SurfaceConfig }) {
  const geometry = getPreviewGeometry(defaultExpression, surface, emptyBodyNodes)
  return (
    <svg viewBox="-150 -150 300 300" aria-hidden="true">
      {geometry.backPaths.map((pathValue, index) => (
        <path d={pathValue} key={index} />
      ))}
      <path d={geometry.headPath} />
    </svg>
  )
}

export function ExpressionPreview({
  expression,
  surface,
  bodyNodes,
  colors,
  avatarEyes,
  renderStyle,
  id,
}: {
  expression: Expression
  surface: SurfaceConfig
  bodyNodes: BodyNode[]
  colors: AvatarColors
  avatarEyes: AvatarEyeDefaults
  renderStyle: AvatarRenderStyle
  id: string
}) {
  const geometry = getPreviewGeometry(expression, surface, bodyNodes, avatarEyes)
  const resolvedColors = resolveColors(expression, colors)
  if (renderStyle.type === 'pixel') {
    return (
      <StaticPixelAvatarCanvas
        className="avatar-preview"
        style={renderStyle}
        frame={{
          headPath: geometry.headPath,
          backPaths: geometry.backPaths,
          frontPaths: geometry.frontPaths,
          leftPath: geometry.leftPath,
          rightPath: geometry.rightPath,
          leftOpacity: geometry.leftVisible ? 1 : 0,
          rightOpacity: geometry.rightVisible ? 1 : 0,
          offsetX: 0,
          offsetY: 0,
          bodyColor: resolvedColors.body,
          eyeColor: resolvedColors.eyes,
        }}
      />
    )
  }
  const clipId = `preview-${id}`
  return (
    <svg className="avatar-preview" viewBox="-150 -150 300 300" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <path d={geometry.headPath} />
        </clipPath>
      </defs>
      {geometry.backPaths.map((pathValue, index) => (
        <path
          className="preview-head"
          d={pathValue}
          key={index}
          style={{ fill: resolvedColors.body }}
        />
      ))}
      <path className="preview-head" d={geometry.headPath} style={{ fill: resolvedColors.body }} />
      <g clipPath={`url(#${clipId})`}>
        <path
          className="preview-eye"
          d={geometry.leftPath}
          opacity={geometry.leftVisible ? 1 : 0}
          style={{ fill: resolvedColors.eyes }}
        />
        <path
          className="preview-eye"
          d={geometry.rightPath}
          opacity={geometry.rightVisible ? 1 : 0}
          style={{ fill: resolvedColors.eyes }}
        />
      </g>
      {geometry.frontPaths.map((pathValue, index) => (
        <path
          className="preview-head"
          d={pathValue}
          key={`front-${index}`}
          style={{ fill: resolvedColors.body }}
        />
      ))}
    </svg>
  )
}

export function ExpressionCard({
  expression,
  index,
  active,
  surface,
  bodyNodes,
  colors,
  avatarEyes,
  renderStyle,
  previewId,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  draggable,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragEnd,
  runtimeError,
}: {
  expression: Expression
  index: number
  active: boolean
  surface: SurfaceConfig
  bodyNodes: BodyNode[]
  colors: AvatarColors
  avatarEyes: AvatarEyeDefaults
  renderStyle: AvatarRenderStyle
  previewId: string
  onSelect: () => void
  onEdit?: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  draggable?: boolean
  onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void
  onDragEnter?: () => void
  onDragOver?: (event: React.DragEvent<HTMLButtonElement>) => void
  onDrop?: (event: React.DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
  runtimeError: string | null
}) {
  const { t } = useStudioLanguage()
  const card = (
    <Button
      className="expression-card"
      variant="outline"
      aria-pressed={active}
      type="button"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      onDoubleClick={onEdit}
    >
      <ExpressionPreview
        expression={expression}
        surface={surface}
        bodyNodes={bodyNodes}
        colors={colors}
        avatarEyes={avatarEyes}
        renderStyle={renderStyle}
        id={previewId}
      />
      {runtimeError && (
        <i
          className="runtime-key-missing"
          role="img"
          aria-label={runtimeError}
          title={runtimeError}
        >
          !
        </i>
      )}
      <span>{String(index).padStart(2, '0')}</span>
    </Button>
  )
  if (!onEdit) return card
  return (
    <ContextMenu>
      <ContextMenuTrigger render={card} />
      <ContextMenuContent>
        <ContextMenuItem onClick={onEdit}>
          <Pencil /> {t('Modifier')}
        </ContextMenuItem>
        {onDuplicate && (
          <ContextMenuItem onClick={onDuplicate}>
            <Copy /> {t('Dupliquer')}
          </ContextMenuItem>
        )}
        {onDelete && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 /> {t('Supprimer')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ExpressionWorkspace({
  editing,
  avatarColors,
  backButtonRef,
  onChange,
  onCancel,
  onSave,
  onDuplicate,
  onDelete,
  semanticKeyError,
}: {
  editing: { index: number | null; draft: Expression }
  avatarColors: AvatarColors
  backButtonRef: RefObject<HTMLButtonElement | null>
  onChange: (draft: Expression) => void
  onCancel: () => void
  onSave: () => void
  onDuplicate: () => void
  onDelete: () => void
  semanticKeyError: string | null
}) {
  const { t } = useStudioLanguage()
  const [linked, setLinked] = useState({
    width: true,
    height: true,
    size: true,
    rotation: true,
  })
  const update = (changes: Partial<Expression>) => onChange({ ...editing.draft, ...changes })
  const updateDimension = (side: Side, dimension: 'width' | 'height', value: number) => {
    onChange(updateEyeDimension(editing.draft, side, dimension, value, linked[dimension]))
  }
  const updateSize = (side: Side, value: number) => {
    onChange(scaleEye(editing.draft, side, value, linked.size))
  }
  const updateRotation = (side: Side, value: number) => {
    onChange({
      ...editing.draft,
      [side === 'Left' ? 'leftAngle' : 'rightAngle']: value,
      ...(linked.rotation ? { [side === 'Left' ? 'rightAngle' : 'leftAngle']: -value } : {}),
    })
  }

  return (
    <>
      <header className="workspace-header">
        <Button
          ref={backButtonRef}
          variant="ghost"
          size="icon"
          onClick={onCancel}
          aria-label={t('Retour aux expressions')}
        >
          <ArrowLeft />
        </Button>
        <div className="workspace-heading">
          <p className="eyebrow">{t('Preset en mémoire')}</p>
          <h1>
            {editing.index === null
              ? t('Nouvelle expression')
              : t(`Modifier l’expression ${String(editing.index).padStart(2, '0')}`)}
          </h1>
          <p>{t('L’avatar à gauche affiche cette expression en direct.')}</p>
        </div>
        {editing.index === null && (
          <Button
            className="workspace-header-reset"
            variant="outline"
            size="icon"
            type="button"
            aria-label={t('Réinitialiser')}
            onClick={() => onChange({ ...defaultExpression })}
          >
            <RotateCcw />
          </Button>
        )}
      </header>
      <div className="workspace-scroll">
        <div className="dialog-fields">
          <ControlSection
            title="Identité runtime"
            subtitle="Nom public stable utilisé par les applications qui chargent cet avatar."
            compact
          >
            <Card className="dialog-group semantic-key-card">
              <Field>
                <label
                  className="semantic-key-label"
                  htmlFor={`expression-key-${editing.draft.id}`}
                >
                  {t('Clé sémantique')}
                </label>
                <Input
                  id={`expression-key-${editing.draft.id}`}
                  value={editing.draft.semanticKey ?? ''}
                  maxLength={64}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-invalid={Boolean(semanticKeyError)}
                  aria-describedby={`expression-key-help-${editing.draft.id}`}
                  onChange={event =>
                    update({ semanticKey: event.currentTarget.value || undefined })
                  }
                />
                <p
                  id={`expression-key-help-${editing.draft.id}`}
                  className={semanticKeyError ? 'semantic-key-error' : 'field-help'}
                  role={semanticKeyError ? 'alert' : undefined}
                >
                  {semanticKeyError ??
                    t('Clé publique stable utilisée par l’API runtime, par exemple happy-smile.')}
                </p>
              </Field>
            </Card>
          </ControlSection>
          <ControlSection
            title="Corps"
            subtitle="Apparence et orientation générale de l’avatar."
            compact
          >
            <Card className="dialog-group color-panel">
              <h3>{t('Couleur du corps')}</h3>
              <ColorField
                label="Corps"
                value={editing.draft.bodyColor ?? avatarColors.body}
                onChange={bodyColor => update({ bodyColor })}
              />
              {editing.draft.bodyColor && (
                <Button
                  className="inherit-colors"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('Reprendre la couleur de l’avatar')}
                  onClick={() => {
                    const draft = { ...editing.draft }
                    delete draft.bodyColor
                    onChange(draft)
                  }}
                >
                  <RotateCcw />
                </Button>
              )}
            </Card>
            <Card className="dialog-group">
              <h3>{t('Mouvement perpétuel')}</h3>
              <AmbientMotionField
                label="Corps"
                value={editing.draft.bodyMotion}
                options={[
                  { value: 'none', label: 'Aucun mouvement' },
                  { value: 'slowDrift', label: 'Dérive lente' },
                  { value: 'shake', label: 'Tremblement' },
                ]}
                onChange={bodyMotion => update({ bodyMotion })}
              />
              <p className="field-help">
                {t('Ajoute une légère présence ou un tremblement continu au corps.')}
              </p>
            </Card>
            <Card className="dialog-group color-panel">
              <h3>{t('Rotation de la tête')}</h3>
              {(['headX', 'headY', 'headZ'] as const).map(field => (
                <NumericField
                  key={field}
                  label={`Rotation ${field.at(-1)?.toUpperCase()}`}
                  value={editing.draft[field]}
                  unit="°"
                  onChange={value => update({ [field]: value })}
                />
              ))}
            </Card>
          </ControlSection>
          <ControlSection
            title="Yeux"
            subtitle="Forme, placement et orientation propres au regard."
            compact
          >
            <Card className="dialog-group color-panel">
              <h3>{t('Couleur des yeux')}</h3>
              <ColorField
                label="Yeux"
                value={editing.draft.eyeColor ?? avatarColors.eyes}
                onChange={eyeColor => update({ eyeColor })}
              />
              {editing.draft.eyeColor && (
                <Button
                  className="inherit-colors"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('Reprendre la couleur de l’avatar')}
                  onClick={() => {
                    const draft = { ...editing.draft }
                    delete draft.eyeColor
                    onChange(draft)
                  }}
                >
                  <RotateCcw />
                </Button>
              )}
            </Card>
            <Card className="dialog-group">
              <h3>{t('Mouvement perpétuel')}</h3>
              <AmbientMotionField
                label="Yeux"
                value={editing.draft.eyeMotion}
                options={[
                  { value: 'none', label: 'Aucun mouvement' },
                  { value: 'microSaccades', label: 'Micro-ajustements' },
                  { value: 'shake', label: 'Tremblement' },
                ]}
                onChange={eyeMotion => update({ eyeMotion })}
              />
              <p className="field-help">
                {t('Anime le regard par petites saccades naturelles ou par tremblement.')}
              </p>
            </Card>
            {(['width', 'height', 'size'] as const).map(dimension => (
              <Card className="dialog-group" key={dimension}>
                <div className="panel-inline-title">
                  <h3>
                    {t(
                      { width: 'Largeur', height: 'Hauteur', size: 'Taille proportionnelle' }[
                        dimension
                      ]
                    )}
                  </h3>
                  <LinkButton
                    linked={linked[dimension]}
                    label={`Lier ${dimension}`}
                    onClick={() =>
                      setLinked(current => ({ ...current, [dimension]: !current[dimension] }))
                    }
                  />
                </div>
                <div className="eye-columns">
                  {(['Left', 'Right'] as Side[]).map(side => {
                    const width = editing.draft[`width${side}`]
                    const height = editing.draft[`height${side}`]
                    const value =
                      dimension === 'width'
                        ? width
                        : dimension === 'height'
                          ? height
                          : Math.max(width, height)
                    return (
                      <NumericField
                        key={side}
                        label={side === 'Left' ? 'Œil gauche' : 'Œil droit'}
                        value={value}
                        min={10}
                        max={dimension === 'size' ? 110 : 100}
                        unit="u"
                        onChange={next =>
                          dimension === 'size'
                            ? updateSize(side, next)
                            : updateDimension(side, dimension, next)
                        }
                      />
                    )
                  })}
                </div>
              </Card>
            ))}
            <Card className="dialog-group">
              <h3>{t('Position et espacement')}</h3>
              <div className="eye-columns">
                {(['Left', 'Right'] as Side[]).map(side => (
                  <div className="eye-column" key={side}>
                    <h3>{t(side === 'Left' ? 'Œil gauche' : 'Œil droit')}</h3>
                    <NumericField
                      label="Horizontale"
                      value={editing.draft[`positionX${side}`]}
                      unit="u"
                      onChange={value => update({ [`positionX${side}`]: value })}
                    />
                    <NumericField
                      label="Verticale"
                      value={editing.draft[`positionY${side}`]}
                      unit="u"
                      onChange={value => update({ [`positionY${side}`]: value })}
                    />
                  </div>
                ))}
              </div>
              <div className="position-spacing">
                <NumericField
                  label="Espacement"
                  value={editing.draft.spacing}
                  min={0}
                  max={150}
                  unit="u"
                  onChange={value => update({ spacing: value })}
                />
              </div>
            </Card>
            <Card className="dialog-group">
              <div className="panel-inline-title">
                <h3>{t('Rotation locale')}</h3>
                <LinkButton
                  linked={linked.rotation}
                  label="Lier les rotations"
                  onClick={() =>
                    setLinked(current => ({ ...current, rotation: !current.rotation }))
                  }
                />
              </div>
              <div className="eye-columns">
                <NumericField
                  label="Œil gauche"
                  value={editing.draft.leftAngle}
                  unit="°"
                  onChange={value => updateRotation('Left', value)}
                />
                <NumericField
                  label="Œil droit"
                  value={editing.draft.rightAngle}
                  unit="°"
                  onChange={value => updateRotation('Right', value)}
                />
              </div>
            </Card>
          </ControlSection>
          <ControlSection
            title="Projection"
            subtitle="Perspective appliquée à la surface active."
            compact
          >
            <Card className="dialog-group">
              <NumericField
                label="Perspective"
                value={editing.draft.perspective}
                step={0.01}
                unit="×"
                onChange={value => update({ perspective: value })}
              />
            </Card>
          </ControlSection>
        </div>
      </div>
      <footer className="workspace-footer">
        <div className="workspace-footer-secondary">
          {editing.index !== null && (
            <Button variant="destructive" onClick={onDelete}>
              <Trash2 />
              {t('Supprimer')}
            </Button>
          )}
          <Button variant="outline" onClick={onDuplicate}>
            <Copy />
            {t('Dupliquer')}
          </Button>
        </div>
        <div className="dialog-actions-main">
          <Button onClick={onSave}>{t('Enregistrer')}</Button>
        </div>
      </footer>
    </>
  )
}
