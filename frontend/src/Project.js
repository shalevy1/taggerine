import React, { Component } from 'react'
import { AutoSizer } from 'react-virtualized'

import saveAs from 'js-file-download'
import { loadFromLocalStorage, saveToLocalStorage } from './localStorage'

import ImageTagList from './ImageTagList'
import DialogHelper from './Dialogs/DialogHelper'
import ImageList from './ImageList'
import RecentTagList from './RecentTagList'
import Tagger from './Tagger'
import axios from 'axios'

import Button from 'material-ui/Button'
import Card, { CardActions, CardContent } from 'material-ui/Card'

import AddIcon from 'material-ui-icons/Add'
import ClearIcon from 'material-ui-icons/Clear'

import './Project.css'
import Header from './Header'

const PRECISION_ERROR = '0.000001'
const API_URL = process.env.REACT_APP_API_URL

let tagId = 0

class Project extends Component {
  state = {
    images: [],
    totalImages: 0,
    tags: [],
    currentImageIndex: 0,
    lastTagPos: {},
    tagFormat: 'xywh',
    showDeleteImageTagsDialog: false,
    settings: {
      bbWidth: 14,
      bbHeight: 14,
      bbNextAlign: 'h'
    }
  }

  saveLocal = () =>
    saveToLocalStorage({
      tags: this.state.tags,
      tagFormat: this.state.tagFormat,
      settings: this.state.settings,
      tagId
    })

  loadFromLocal = () => {
    const loaded = loadFromLocalStorage()
    if (loaded) {
      tagId = loaded.tagId
      delete loaded.tagId
      this.setState(loaded)
    }
  }

  /*
   * Save tags and images to the API DB
   */
  saveToBackend = () => {
    var imgName = this.state.images[this.state.currentImageIndex].name
    var imgTags = this.state.images[this.state.currentImageIndex].tags
    var headers: { 'content-type': 'application/json' }
    axios.post(
      `${API_URL}/projects/${this.props.match.params.project_id}/image/${imgName}/tags`,
      imgTags,
      headers
    )
  }

  componentWillMount() {
    this.loadFromLocal()
  }

  componentDidMount() {
    this.getImages().then(() => {
      let intervalId = setInterval(() => {
        if (this.state.totalImages > this.state.images.length) {
          this.getImages()
        } else {
          clearInterval(intervalId)
          intervalId = null
        }
      }, 3000)
    })
  }

  nextImage = () => {
    this.setState(prevState => {
      const currentImageIndex =
        prevState.images.length > prevState.currentImageIndex + 1
          ? prevState.currentImageIndex + 1
          : 0
      return {
        currentImageIndex: currentImageIndex
      }
    }) // avoid saving state here, currentImageIndex is not saved, so this can only hide bugs
  }

  prevImage = () => {
    this.setState(prevState => {
      const currentImageIndex =
        prevState.currentImageIndex > 0
          ? prevState.currentImageIndex - 1
          : prevState.images.length - 1
      return {
        currentImageIndex: currentImageIndex
      }
    }) // avoid saving state here, currentImageIndex is not saved, so this can only hide bugs
  }

  uploadImages = images => {
    let data = new FormData()
    const batchLimit = 100

    const config = {
      headers: { 'content-type': 'multipart/form-data' }
    }

    for (var i = 0; i < images.length; i++) {
      let file = images[i]
      data.append('file[' + i + ']', file, file.name)
      if (i % batchLimit === 0 && i > 0) {
        axios
          .post(`${API_URL}/projects/${this.props.match.params.project_id}/images`, data, config)
          .then(this.getImages)
        data = new FormData()
      }
    }
    axios
      .post(`${API_URL}/projects/${this.props.match.params.project_id}/images`, data, config)
      .then(this.getImages)
  }

  _tagFormat = newTags => {
    let result = 'empty'
    if (newTags.length > 0 && 'x' in newTags[0]) {
      result = 'xywh'
    } else if (newTags.length > 0 && 'x_min' in newTags[0]) {
      result = 'xyxy'
    }
    return result
  }

  _mergeTags = (newTags, oldTags) => {
    const format = this._tagFormat(newTags)
    return newTags.map(newTag => {
      const tag = oldTags.find(oldTag => {
        if (oldTag.name !== newTag.label) return false
        if (format === 'xywh') {
          return (
            oldTag.x === newTag.x &&
            oldTag.y === newTag.y &&
            oldTag.width === newTag.width &&
            oldTag.height === newTag.height
          )
        } else {
          return (
            oldTag.x === newTag.x_min &&
            oldTag.y === newTag.y_min &&
            Math.abs(newTag.x_max - newTag.x_min - oldTag.width) < PRECISION_ERROR &&
            Math.abs(newTag.y_max - newTag.y_min - oldTag.height) < PRECISION_ERROR
          )
        }
      })

      if (Boolean(tag)) return tag
      else {
        let id = tagId
        tagId += 1
        if (format === 'xyxy') this._XYXYFormatToXYWH(tagId, newTag)
        else newTag.id = id
        return newTag
      }
    })
  }

  _XYXYFormatToXYWH = (id, bbox) => {
    bbox.id = id
    bbox.x = bbox.x_min
    bbox.y = bbox.y_min
    bbox.width = bbox.x_max - bbox.x_min
    bbox.height = bbox.y_max - bbox.y_min
    delete bbox.x_min
    delete bbox.y_min
    delete bbox.y_max
    delete bbox.y_min
  }

  /*
   * Calculate next bb position and size from previous bbox's values
   * Placement of next bbox can be configured to be vertically or horizontally aligned (bbNextAlign)
   * If canvas edges are reached, go to next row/column, or restart from top left corner.
   */
  _calculateNextBBox(tagPos) {
    var x, y, width, height

    x = this.state.settings.bbNextAlign === 'h' ? tagPos.x + tagPos.width : tagPos.x
    if (x + tagPos.width >= 1) {
      // outside screen horizontally, go to next row
      x = 0
      y = tagPos.y + tagPos.height
    } else {
      y = this.state.settings.bbNextAlign === 'v' ? tagPos.y + tagPos.height : tagPos.y
    }
    if (y + tagPos.height >= 1) {
      // outside screen vertically, go to next column
      x = tagPos.x + tagPos.width
      y = 0
    }
    if (x + tagPos.width >= 1) {
      // Still outside screen? go to top left corner
      x = 0
      y = 0
    }
    width = tagPos.width
    height = tagPos.height
    return { x, y, width, height }
  }

  uploadTags = tagFile => {
    let reader = new FileReader()
    reader.onload = e => {
      let tags = []
      const uploadedTags = JSON.parse(e.target.result)
      const images = this.state.images.map(image => {
        const newTags = uploadedTags[image.name]
        if (Boolean(newTags)) {
          tags = [...new Set([...tags, ...newTags.map(t => t.label)])]
          return { ...image, tags: this._mergeTags(newTags, image.tags) }
        } else return image
      })
      this.setState({ images, tags }, this.saveToBackend)
    }
    reader.readAsText(tagFile)
  }

  downloadTags = format => {
    const xywh = format.toUpperCase() === 'XYWH'
    const toDownload = this.state.images.reduce((acc, image) => {
      let data = image.tags
      if (xywh) {
        data = image.tags.map(({ x, y, width, height, id, label }) => ({
          x_min: x,
          y_min: y,
          x_max: x + width,
          y_max: y + height,
          label
        }))
      }
      return { ...acc, [image.name]: data }
    }, {})
    const content = JSON.stringify(toDownload)
    saveAs(content, 'project-name.json', 'application/json;charset=utf-8')
  }

  generateTagList = images => {
    let tags = new Set()
    images.forEach(image => image.tags.forEach(tag => tags.add(tag.label)))
    return [...tags]
  }

  addTag = () => {
    this.repeatTag(`tag${tagId}`)
  }

  repeatTag = label => {
    let lastTagPos = this.state.lastTagPos
    var x, y, width, height

    // Is there a previous bbox with this label?
    if (lastTagPos[label]) {
      // If a bbox with the same label exists, place new bbox next to it
      ;({ x, y, width, height } = this._calculateNextBBox(lastTagPos[label]))
    } else {
      // First bbox with this label: place it in top left corner, with default w/h configured
      x = 0
      y = 0
      width = this.state.settings.bbWidth / 100
      height = this.state.settings.bbHeight / 100
    }
    const newTag = { x, y, width, height, label: label, id: tagId }
    lastTagPos[label] = newTag
    tagId += 1

    const images = [...this.state.images]
    const newImage = images[this.state.currentImageIndex]
    images[this.state.currentImageIndex] = { ...newImage, tags: [...newImage.tags, newTag] }

    const tags = this.generateTagList(images)

    this.setState({ images, tags, lastTagPos }, this.saveToBackend)
  }

  updateTag = tag => {
    const { images, currentImageIndex } = this.state
    const imageTags = [...images[currentImageIndex].tags]
    const tagIdx = imageTags.findIndex(t => t.id === tag.id)
    imageTags[tagIdx] = tag

    const newImages = [...images]
    newImages[currentImageIndex].tags = imageTags

    const tags = this.generateTagList(newImages)

    const lastTagPos = this.state.lastTagPos
    lastTagPos[tag.label] = tag

    this.setState({ images: newImages, tags, lastTagPos }, this.saveToBackend)
  }

  updateTagLabel = (tagIdx, label) => {
    const { images, currentImageIndex } = this.state
    const image = images[currentImageIndex]

    const newTag = { ...image.tags[tagIdx], label }
    const newTags = [...image.tags]
    newTags[tagIdx] = newTag
    const newImage = { ...image, tags: newTags }
    const newImages = [...images]
    newImages[currentImageIndex] = newImage

    const tags = this.generateTagList(newImages)

    // Update information of last block for the new label
    const lastTagPos = this.state.lastTagPos
    lastTagPos[label] = newTag

    this.setState({ images: newImages, tags, lastTagPos }, this.saveToBackend)
  }

  removeTag = id => {
    const { images, currentImageIndex } = this.state
    const imageTags = [...images[currentImageIndex].tags].filter(t => t.id !== id)

    const newImages = [...this.state.images]
    newImages[currentImageIndex].tags = imageTags

    const tags = this.generateTagList(newImages)

    this.setState({ images: newImages, tags }, this.saveToBackend)
  }

  cleanAllTags = e => {
    const tags = []
    const images = [...this.state.images].map(image => ({ ...image, tags: [] }))
    this.setState({ images, tags }, this.saveToBackend)
  }

  confirmDeleteImageTags = confirmed => {
    this.setState({ showDeleteImageTagsDialog: false })
    if (confirmed) {
      const { images, currentImageIndex } = this.state
      const image = images[currentImageIndex]
      const newImage = { ...image, tags: [] }
      const newImages = [...images]
      newImages[currentImageIndex] = newImage

      const tags = this.generateTagList(newImages)

      this.setState({ images: newImages, tags }, this.saveToBackend)
    }
  }

  /*
   * Fetch all listed image files in API_URL, and mix them with the images saved in the state.
   * If an image file is not in the current state, load it anyway without tags.
   */
  getImages = () => {
    const projectId = this.props.match.params.project_id
    const imagesAPIURL = `${API_URL}/projects/${projectId}/images`

    return axios.get(imagesAPIURL).then(response => {
      this.setState({
        // Fill image objects in the state from the API response
        images: response.data.images.map(imageObj => ({
          name: imageObj.name,
          url: `${imagesAPIURL}/${imageObj.name}`,
          thumbnailURL: `${imagesAPIURL}/thumbnail/${imageObj.name}`,
          tags: imageObj.tags ? imageObj.tags : []
        })),
        totalImages: response.data.total_images
      })
    })
  }

  handleImageSelection = currentImageIndex => this.setState({ currentImageIndex })

  onSettingsChange = newSettings => {
    this.setState({ settings: newSettings }, this.saveLocal)
  }

  showDeleteImageTagsDialog = () => {
    this.setState({ showDeleteImageTagsDialog: true })
  }

  render() {
    const { images, currentImageIndex, tags } = this.state
    const currentImage = images[currentImageIndex]
    const currentImageTags = currentImage ? currentImage.tags : []

    return (
      <div className="Project">
        <Header
          onUploadImage={this.uploadImages}
          onImportTags={this.uploadTags}
          onExportTags={this.downloadTags}
          onDelete={this.cleanAllTags}
          onSettingsChange={this.onSettingsChange}
          settings={this.state.settings}
        />
        <Card id="uploaded-list">
          <CardContent>
            <ImageList
              imageList={images}
              selectedIdx={currentImageIndex}
              onSelect={this.handleImageSelection}
            />
          </CardContent>
        </Card>
        <div id="tagger">
          <AutoSizer>
            {({ width, height }) => (
              <div style={{ width, height }} className="autosized-tagger">
                {currentImage && (
                  <Tagger
                    image={currentImage}
                    onTagMove={this.updateTag}
                    width={width - 60}
                    height={height}
                  />
                )}
              </div>
            )}
          </AutoSizer>
        </div>
        <Card id="taglist-recentlist">
          <CardContent className="taglist-cardcontent">
            <RecentTagList tagList={tags} onSelect={this.repeatTag} />
          </CardContent>
          <CardActions className="taglist-cardactions">
            <Button color="primary" onClick={this.addTag} disabled={!images.length}>
              <AddIcon />
            </Button>
          </CardActions>
        </Card>
        <Card id="taglist-imagetags">
          <CardContent className="taglist-cardcontent">
            <ImageTagList
              imageTags={currentImageTags}
              onTagLabelChange={this.updateTagLabel}
              onRepeatTag={this.repeatTag}
              onRemoveTag={this.removeTag}
            />
          </CardContent>
          <CardActions className="taglist-cardactions">
            <Button
              color="primary"
              onClick={this.showDeleteImageTagsDialog}
              disabled={!currentImageTags.length}
            >
              <ClearIcon />
            </Button>
            <DialogHelper
              open={this.state.showDeleteImageTagsDialog}
              title="Delete all tags from this image?"
              message="Are you sure that you want to delete all bounding boxes from this image? This can't be undone."
              onConfirm={() => this.confirmDeleteImageTags(true)}
              onCancel={() => this.confirmDeleteImageTags(false)}
            />
          </CardActions>
        </Card>
      </div>
    )
  }
}

export default Project
